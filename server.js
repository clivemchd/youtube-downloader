require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Innertube, UniversalCache } = require('youtubei.js');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const logger = require('./logger');

// Get environment variables with defaults
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const DOWNLOAD_LIMIT_WINDOW_MS = parseInt(process.env.DOWNLOAD_LIMIT_WINDOW_MS || '3600000', 10); // 1 hour
const DOWNLOAD_LIMIT_MAX_REQUESTS = parseInt(process.env.DOWNLOAD_LIMIT_MAX_REQUESTS || '10', 10);
const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, 'temp');

// Initialize cache with 1 hour TTL
const videoCache = new NodeCache({ 
    stdTTL: 3600, // 1 hour in seconds
    checkperiod: 120, // Check for expired entries every 2 minutes
    useClones: false // Store/retrieve references instead of cloning data
});

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Helper function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Innertube client (lazy loaded)
let innertubeClient = null;
const getInnertubeClient = async () => {
    if (!innertubeClient) {
        innertubeClient = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locally: true,
        });
        logger.info('Innertube client initialized');
    }
    return innertubeClient;
};

// Extract videoId from URL
const getVideoID = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : url;
};

// Helper function to get video info with retry logic and caching
async function getVideoInfoWithRetry(url, type, retryCount = 0) {
    try {
        // Clean and validate the URL
        const videoId = getVideoID(url);
        
        // Check cache first
        const cacheKey = `${videoId}-${type}`;
        const cachedData = videoCache.get(cacheKey);
        
        if (cachedData) {
            logger.info('Serving video info from cache', { videoId });
            return cachedData;
        }

        // If not in cache, fetch from YouTube
        logger.info('Fetching video info from YouTube', { videoId });
        
        // Get the Innertube client
        const yt = await getInnertubeClient();
        const info = await yt.getInfo(videoId);
        
        if (!info) {
            throw new Error('Failed to fetch video information');
        }
        
        // Process formats based on type
        let formats;
        const streamingData = info.streaming_data;
        
        if (type === 'audio') {
            // Filter audio formats
            formats = streamingData.adaptive_formats
                .filter(format => format.audio_quality && !format.has_video)
                .map(format => ({
                    itag: format.itag,
                    quality: format.audio_quality,
                    container: format.mime_type.split('/')[1].split(';')[0],
                    audioQuality: format.audio_quality,
                    bitrate: format.bitrate
                }))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        } else {
            // Filter video formats
            const videoFormats = streamingData.adaptive_formats
                .filter(format => format.has_video)
                .map(format => ({
                    itag: format.itag,
                    quality: format.quality_label || format.quality,
                    container: format.mime_type.split('/')[1].split(';')[0],
                    hasAudio: format.has_audio,
                    fps: format.fps || 0,
                    videoCodec: format.mime_type.includes('codecs=') 
                        ? format.mime_type.split('codecs=')[1].replace(/"/g, '').split(',')[0] 
                        : null,
                    audioCodec: (format.has_audio && format.mime_type.includes('codecs=')) 
                        ? format.mime_type.split('codecs=')[1].replace(/"/g, '').split(',')[1] 
                        : null,
                    bitrate: format.bitrate
                }))
                .sort((a, b) => {
                    const qualityA = parseInt(a.quality) || 0;
                    const qualityB = parseInt(b.quality) || 0;
                    if (qualityA === qualityB) {
                        if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
                        return (b.fps || 0) - (a.fps || 0);
                    }
                    return qualityB - qualityA;
                });

            formats = Object.values(videoFormats.reduce((acc, format) => {
                const quality = format.quality;
                if (!acc[quality] || (format.hasAudio && !acc[quality].hasAudio)) {
                    acc[quality] = format;
                }
                return acc;
            }, {}));
        }

        // Prepare response data
        const responseData = {
            title: info.basic_info.title,
            formats: formats,
            videoDetails: {
                title: info.basic_info.title,
                lengthSeconds: info.basic_info.duration,
                author: info.basic_info.author,
                videoId: videoId,
                isLive: info.basic_info.is_live,
                thumbnails: info.basic_info.thumbnail
            }
        };

        // Cache the processed data
        videoCache.set(cacheKey, responseData);
        logger.info('Cached video info', { videoId });

        return responseData;
    } catch (error) {
        // If we hit YouTube's rate limit and haven't exceeded max retries
        if ((error.message.includes('Status code: 429') || error.message.includes('Sign in to confirm')) && retryCount < MAX_RETRIES) {
            const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            logger.info(`YouTube rate limit hit, retrying in ${waitTime}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await delay(waitTime);
            return getVideoInfoWithRetry(url, type, retryCount + 1);
        }
        throw error;
    }
}

// Helper function to get video stream with retry logic
async function getVideoStreamWithRetry(url, options, retryCount = 0) {
    try {
        const videoId = getVideoID(url);
        const yt = await getInnertubeClient();
        const info = await yt.getInfo(videoId);
        
        if (!info || !info.streaming_data) {
            throw new Error('No streaming data available');
        }
        
        // Find the format with the specified itag
        const format = info.streaming_data.adaptive_formats.find(f => f.itag === parseInt(options.quality)) || 
                      info.streaming_data.formats.find(f => f.itag === parseInt(options.quality));
        
        if (!format) {
            throw new Error(`Format with itag ${options.quality} not found`);
        }
        
        // Handle filter options (audio only or video only)
        if (options.filter === 'audioonly' && !format.has_audio) {
            const audioFormat = info.streaming_data.adaptive_formats
                .filter(f => f.has_audio && !f.has_video)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                
            if (!audioFormat) {
                throw new Error('No audio format found');
            }
            
            const stream = await yt.download(videoId, {
                type: 'audio',
                quality: audioFormat.itag.toString()
            });
            
            return stream;
        } else if (options.filter === 'videoonly' && !format.has_video) {
            const videoFormat = info.streaming_data.adaptive_formats
                .filter(f => f.has_video && !f.has_audio)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                
            if (!videoFormat) {
                throw new Error('No video format found');
            }
            
            const stream = await yt.download(videoId, {
                type: 'video',
                quality: videoFormat.itag.toString()
            });
            
            return stream;
        }
        
        // Download the requested format
        const stream = await yt.download(videoId, {
            type: format.has_video ? 'video' : 'audio',
            quality: format.itag.toString()
        });
        
        return stream;
    } catch (error) {
        if ((error.message.includes('Status code: 429') || error.message.includes('Sign in to confirm')) && retryCount < MAX_RETRIES) {
            const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            logger.info(`YouTube rate limit hit for download, retrying in ${waitTime}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await delay(waitTime);
            return getVideoStreamWithRetry(url, options, retryCount + 1);
        }
        throw error;
    }
}

// Helper function to choose the best format based on itag
function chooseFormat(formats, options) {
    const format = formats.find(f => f.itag === parseInt(options.quality));
    if (!format) {
        throw new Error(`Format with itag ${options.quality} not found`);
    }
    return format;
}

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    logger.info(`Created temporary directory: ${TEMP_DIR}`);
}

// Rate limiting configuration
const videoInfoLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: {
        error: 'Too many requests',
        details: `Please try again after ${Math.ceil(RATE_LIMIT_WINDOW_MS / 60000)} minutes`
    },
    standardHeaders: true,
    legacyHeaders: false
});

const downloadLimiter = rateLimit({
    windowMs: DOWNLOAD_LIMIT_WINDOW_MS,
    max: DOWNLOAD_LIMIT_MAX_REQUESTS,
    message: {
        error: 'Download limit exceeded',
        details: `Please try again after ${Math.ceil(DOWNLOAD_LIMIT_WINDOW_MS / 60000)} minutes`
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply middleware
app.use(cors());
app.use(express.json());

// Serve static files from the appropriate directory based on environment
if (NODE_ENV === 'production') {
    app.use(express.static('dist'));
    logger.info('Serving static files from dist directory (production mode)');
} else {
    app.use(express.static('public'));
    logger.info('Serving static files from public directory (development mode)');
}

// Apply rate limiters to specific routes
app.use('/video-info', videoInfoLimiter);
app.use('/download', downloadLimiter);

// Route to get video info (simplified to use new caching function)
app.get('/video-info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        const type = req.query.type || 'video';
        
        if (!videoURL) {
            throw new Error('No URL provided');
        }

        const videoInfo = await getVideoInfoWithRetry(videoURL, type);
        res.json(videoInfo);
        
    } catch (error) {
        logger.error('Error in /video-info', { 
            error: error.message,
            stack: error.stack,
            url: req.query.url 
        });
        
        let statusCode = 400;
        let errorMessage = 'Failed to fetch video information. Please make sure the URL is correct and the video is available.';
        
        if (error.message.includes('Status code: 429')) {
            statusCode = 429;
            errorMessage = 'YouTube API rate limit reached. Please try again in a few seconds.';
        }
        
        res.status(statusCode).json({ 
            error: error.message,
            details: errorMessage
        });
    }
});

// Route to download video or audio
app.get('/download', async (req, res) => {
    let videoStream = null;
    let audioStream = null;
    let ffmpegCommand = null;
    
    try {
        const { url, itag, type = 'video' } = req.query;

        if (!url || !itag) {
            throw new Error('Missing URL or quality selection');
        }

        // Clean and validate the URL
        const videoId = getVideoID(url);
        const cleanURL = `https://www.youtube.com/watch?v=${videoId}`;

        logger.info('Starting download for:', cleanURL, 'with itag:', itag, 'type:', type);
        
        // Use retry-enabled function to get video info
        const info = await getVideoInfoWithRetry(cleanURL, type);
        const format = chooseFormat(info.formats, { quality: itag });
        
        if (!format) {
            throw new Error('Selected quality format not available');
        }

        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
        const extension = type === 'audio' ? 'mp3' : 'mp4';
        
        // Set headers for proper download
        res.header('Content-Disposition', `attachment; filename="${title}.${extension}"`);
        res.header('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');

        if (type === 'audio') {
            // For audio, use FFmpeg to convert to MP3
            logger.info('Converting audio stream to MP3...');
            
            // Create FFmpeg command for audio conversion
            const ffmpeg = require('child_process').spawn(ffmpegPath, [
                '-i', 'pipe:0',
                '-c:a', 'libmp3lame',
                '-q:a', '2',
                '-f', 'mp3',
                'pipe:1'
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            // Get audio stream with retry logic
            audioStream = await getVideoStreamWithRetry(cleanURL, {
                quality: itag,
                filter: 'audioonly'
            });

            // Pipe stream through FFmpeg
            audioStream.pipe(ffmpeg.stdio[0]);
            ffmpeg.stdio[1].pipe(res);

            // Handle FFmpeg errors
            ffmpeg.stderr.on('data', (data) => {
                const logMessage = data.toString();
                if (logMessage.includes('Error') || logMessage.includes('error')) {
                    logger.error('FFmpeg Error:', logMessage);
                } else {
                    logger.debug('FFmpeg Log:', logMessage);
                }
            });

            // Handle stream errors
            audioStream.on('error', async (err) => {
                logger.error('Audio stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({
                        error: 'Audio stream failed',
                        details: err.message
                    });
                }
                ffmpeg.kill();
            });

            // Handle FFmpeg process exit
            ffmpeg.on('exit', (code, signal) => {
                if (code !== null && code !== 0) {
                    logger.error('FFmpeg process exited with code:', code);
                }
                if (signal !== null) {
                    logger.error('FFmpeg process was killed with signal:', signal);
                }
            });

            // Store FFmpeg process for cleanup
            ffmpegCommand = ffmpeg;
        } else {
            // For video, check if we need to merge streams
            const selectedFormat = info.formats.find(f => f.itag === parseInt(itag));
            
            if (selectedFormat.hasAudio) {
                // If the format has audio, we can stream directly with retry logic
                const stream = await getVideoStreamWithRetry(cleanURL, { quality: itag });
                stream.pipe(res);
            } else {
                // If no audio in the video stream, we need to merge with best audio
                logger.info('Merging video and audio streams...');

                // Create FFmpeg command with custom stream handling
                const ffmpeg = require('child_process').spawn(ffmpegPath, [
                    '-i', 'pipe:3',
                    '-i', 'pipe:4',
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-f', 'mp4',
                    '-movflags', 'frag_keyframe+empty_moov',
                    'pipe:1'
                ], {
                    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                    windowsHide: true
                });

                // Get video and audio streams with retry logic
                videoStream = await getVideoStreamWithRetry(cleanURL, {
                    quality: itag,
                    filter: 'videoonly'
                });

                audioStream = await getVideoStreamWithRetry(cleanURL, {
                    quality: 'highestaudio',
                    filter: 'audioonly'
                });

                // Pipe streams to FFmpeg
                videoStream.pipe(ffmpeg.stdio[3]);
                audioStream.pipe(ffmpeg.stdio[4]);
                ffmpeg.stdio[1].pipe(res);

                // Handle FFmpeg errors
                ffmpeg.stderr.on('data', (data) => {
                    const logMessage = data.toString();
                    if (logMessage.includes('Error') || logMessage.includes('error')) {
                        logger.error('FFmpeg Error:', logMessage);
                    } else {
                        logger.debug('FFmpeg Log:', logMessage);
                    }
                });

                // Handle stream errors with retry logic
                videoStream.on('error', async (err) => {
                    logger.error('Video stream error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({
                            error: 'Video stream failed',
                            details: err.message
                        });
                    }
                    ffmpeg.kill();
                });

                audioStream.on('error', async (err) => {
                    logger.error('Audio stream error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({
                            error: 'Audio stream failed',
                            details: err.message
                        });
                    }
                    ffmpeg.kill();
                });

                // Handle FFmpeg process exit
                ffmpeg.on('exit', (code, signal) => {
                    if (code !== null && code !== 0) {
                        logger.error('FFmpeg process exited with code:', code);
                    }
                    if (signal !== null) {
                        logger.error('FFmpeg process was killed with signal:', signal);
                    }
                });

                // Store FFmpeg process for cleanup
                ffmpegCommand = ffmpeg;
            }
        }

        // Handle client disconnection
        req.on('close', () => {
            logger.info('Download cancelled by client', { videoId });
            if (videoStream) videoStream.destroy();
            if (audioStream) audioStream.destroy();
            if (ffmpegCommand) ffmpegCommand.kill();
        });

    } catch (error) {
        logger.error('Error in /download:', error);
        if (!res.headersSent) {
            let statusCode = 400;
            let errorMessage = 'Failed to download. Please try again or select a different quality.';
            
            if (error.message.includes('Status code: 429') || error.message.includes('Sign in to confirm')) {
                statusCode = 429;
                errorMessage = 'YouTube API rate limit reached. Please try again in a few seconds.';
            }
            
            res.status(statusCode).json({ 
                error: error.message,
                details: errorMessage
            });
        } else {
            // If headers were already sent, just end the response
            try {
                res.end();
            } catch (endError) {
                // Handle EPIPE errors that might occur when ending the response
                if (endError.code === 'EPIPE') {
                    logger.warn('EPIPE error when ending response - client likely disconnected');
                } else {
                    logger.error('Error ending response:', endError);
                }
            }
        }
        
        // Clean up streams
        if (videoStream) videoStream.destroy();
        if (audioStream) audioStream.destroy();
        if (ffmpegCommand) ffmpegCommand.kill();
    }
});

// Add global error handler for stream errors
app.use((err, req, res, next) => {
    // Handle EPIPE errors specifically
    if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) {
        logger.warn('EPIPE error in middleware - client likely disconnected');
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Connection error',
                details: 'The connection was interrupted. Please try again.'
            });
        } else {
            try {
                res.end();
            } catch (endError) {
                logger.warn('Error ending response after EPIPE:', endError);
            }
        }
        return;
    }
    
    // Handle other errors
    logger.error('Unhandled error:', err);
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error',
            details: 'An unexpected error occurred. Please try again later.'
        });
    } else {
        try {
            res.end();
        } catch (endError) {
            logger.warn('Error ending response after error:', endError);
        }
    }
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Cleanup function to remove temp files
function cleanup() {
    if (fs.existsSync(TEMP_DIR)) {
        fs.readdirSync(TEMP_DIR).forEach(file => {
            fs.unlinkSync(path.join(TEMP_DIR, file));
        });
        logger.info(`Cleaned up temporary directory: ${TEMP_DIR}`);
    }
}

// Clean up temp files on server start
cleanup();

// Clean up temp files on server exit
process.on('SIGINT', () => {
    logger.info('Server shutting down');
    cleanup();
    process.exit();
});

// Export the app for testing before starting the server
module.exports = app;

// Only start the server if this file is run directly (not required by tests)
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Server is running in ${NODE_ENV} mode on port ${PORT}`);
        logger.info(`Using youtubei.js for YouTube API access`);
    });
} 