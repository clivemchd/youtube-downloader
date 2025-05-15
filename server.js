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

// Create reusable client to avoid initialization overhead
let innertubeClient = null;
let clientLastInitialized = 0;
const CLIENT_REFRESH_INTERVAL = 3600000; // 1 hour in milliseconds

// Helper function to get or create an Innertube client
async function getInnertubeClient() {
    const now = Date.now();
    
    // If client exists and is not too old, return it
    if (innertubeClient && now - clientLastInitialized < CLIENT_REFRESH_INTERVAL) {
        return innertubeClient;
    }
    
    logger.info('Initializing Innertube client');
    
    try {
        // Initialize with recommended options to avoid bot detection
        innertubeClient = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locally: true,
            retrieve_player: true, // Needed for some format deciphering
            default_innertube_clients: {
                web: { client_name: 'WEB', client_version: '2.20230620.00.00' },
                android: { client_name: 'ANDROID', client_version: '18.19.35' },
                ios: { client_name: 'iOS', client_version: '18.19.35' }
            },
            device_category: 'desktop',
            // Standard desktop user agent
            fetch_options: {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9"
                }
            }
        });
        
        clientLastInitialized = now;
        logger.info('Innertube client initialized');
        
        return innertubeClient;
    } catch (error) {
        logger.error('Failed to initialize Innertube client', { 
            error: error.message,
            stack: error.stack 
        });
        throw new Error(`Failed to initialize YouTube API client: ${error.message}`);
    }
}

// Extract videoId from URL
const getVideoID = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : url;
};

// Helper function to safely access YouTube API response properties
function safelyGetFormats(info) {
    if (!info || !info.streaming_data) {
        return { adaptiveFormats: [], regularFormats: [] };
    }
    
    const adaptiveFormats = info.streaming_data.adaptive_formats || [];
    const regularFormats = info.streaming_data.formats || [];
    
    return { adaptiveFormats, regularFormats };
}

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
        
        // Safely get formats
        const { adaptiveFormats, regularFormats } = safelyGetFormats(info);
        
        // If no formats found at all, throw an error
        if (adaptiveFormats.length === 0 && regularFormats.length === 0) {
            logger.error('No formats found for video', { videoId });
            throw new Error('No formats found for this video. The video might be restricted or unavailable.');
        }
        
        // Process formats based on type
        let formats = [];
        
        if (type === 'audio') {
            // Filter audio formats
            formats = adaptiveFormats
                .filter(format => format.has_audio && !format.has_video)
                .map(format => ({
                    itag: format.itag,
                    quality: format.audio_quality || 'medium',
                    container: format.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                    audioQuality: format.audio_quality || 'medium',
                    bitrate: format.bitrate
                }))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                
            // If no audio formats found, try to find any format with audio
            if (formats.length === 0) {
                formats = adaptiveFormats
                    .filter(format => format.has_audio)
                    .map(format => ({
                        itag: format.itag,
                        quality: format.audio_quality || 'medium',
                        container: format.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                        audioQuality: format.audio_quality || 'medium',
                        bitrate: format.bitrate
                    }))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            }
            
            // If still no formats found, try regular formats
            if (formats.length === 0) {
                formats = regularFormats
                    .filter(format => format.has_audio)
                    .map(format => ({
                        itag: format.itag,
                        quality: format.audio_quality || 'medium',
                        container: format.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                        audioQuality: format.audio_quality || 'medium',
                        bitrate: format.bitrate
                    }))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            }
        } else {
            // Filter video formats
            const videoFormats = adaptiveFormats
                .filter(format => format.has_video)
                .map(format => ({
                    itag: format.itag,
                    quality: format.quality_label || format.quality || 'unknown',
                    container: format.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                    hasAudio: !!format.has_audio,
                    fps: format.fps || 0,
                    bitrate: format.bitrate
                }))
                .sort((a, b) => {
                    // Try to sort by numeric quality if available
                    const qualityA = parseInt(a.quality) || 0;
                    const qualityB = parseInt(b.quality) || 0;
                    
                    if (qualityA === qualityB) {
                        // If same quality, prefer formats with audio
                        if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
                        // Otherwise prefer higher FPS
                        return (b.fps || 0) - (a.fps || 0);
                    }
                    
                    return qualityB - qualityA;
                });

            // Group by quality
            formats = videoFormats;
            
            // If no formats were found, try to include regular formats as well
            if (formats.length === 0) {
                formats = regularFormats
                    .map(format => ({
                        itag: format.itag,
                        quality: format.quality_label || format.quality || 'unknown',
                        container: format.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
                        hasAudio: !!format.has_audio,
                        fps: format.fps || 0,
                        bitrate: format.bitrate
                    }))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            }
        }
        
        // Check if we found any formats
        if (formats.length === 0) {
            logger.error('No suitable formats found', { videoId, type });
            throw new Error(`No suitable ${type} formats found for this video.`);
        }

        // Prepare response data
        const responseData = {
            title: info.basic_info?.title || 'Untitled Video',
            formats: formats,
            videoDetails: {
                title: info.basic_info?.title || 'Untitled Video',
                lengthSeconds: info.basic_info?.duration || 0,
                author: info.basic_info?.author || 'Unknown',
                videoId: videoId,
                isLive: !!info.basic_info?.is_live,
                thumbnails: info.basic_info?.thumbnail || []
            }
        };

        // Cache the processed data
        videoCache.set(cacheKey, responseData);
        logger.info('Cached video info', { videoId });

        return responseData;
    } catch (error) {
        // Log detailed error information
        logger.error('Error fetching video info', { 
            error: error.message,
            stack: error.stack,
            videoId: getVideoID(url),
            retryCount
        });
        
        // If we hit YouTube's rate limit and haven't exceeded max retries
        if ((error.message.includes('Status code: 429') || 
            error.message.includes('Sign in to confirm') || 
            error.message.includes('streaming data')) && 
            retryCount < MAX_RETRIES) {
            const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            logger.info(`YouTube API error, retrying in ${waitTime}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
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
        
        logger.info('Fetching stream data for video', { videoId, options });
        
        const info = await yt.getInfo(videoId);
        
        if (!info) {
            throw new Error('Failed to fetch video information');
        }
        
        // Safely get formats
        const { adaptiveFormats, regularFormats } = safelyGetFormats(info);
        
        // If no formats found at all, throw an error
        if (adaptiveFormats.length === 0 && regularFormats.length === 0) {
            logger.error('No formats found for video', { videoId });
            throw new Error('No formats found for this video. The video might be restricted or unavailable.');
        }
        
        // Find the format with the specified itag
        const format = adaptiveFormats.find(f => f.itag === parseInt(options.quality)) || 
                       regularFormats.find(f => f.itag === parseInt(options.quality));
        
        // Special handling for 'highestaudio' quality option
        if (options.quality === 'highestaudio') {
            const audioFormats = adaptiveFormats
                .filter(f => f.has_audio && !f.has_video)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                
            if (audioFormats.length > 0) {
                logger.info('Found highest audio format', { 
                    itag: audioFormats[0].itag, 
                    bitrate: audioFormats[0].bitrate
                });
                
                const stream = await yt.download(videoId, {
                    type: 'audio',
                    quality: audioFormats[0].itag.toString()
                });
                
                return stream;
            } else {
                // Fallback to any format with audio
                const anyAudioFormat = adaptiveFormats
                    .filter(f => f.has_audio)
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] ||
                    regularFormats
                    .filter(f => f.has_audio)
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                    
                if (anyAudioFormat) {
                    logger.info('Falling back to format with audio', { 
                        itag: anyAudioFormat.itag, 
                        hasVideo: anyAudioFormat.has_video
                    });
                    
                    const stream = await yt.download(videoId, {
                        type: 'audio',
                        quality: anyAudioFormat.itag.toString()
                    });
                    
                    return stream;
                }
                
                throw new Error('No audio formats found for this video');
            }
        }
        
        if (!format) {
            logger.error('Format not found', { 
                itag: options.quality, 
                availableFormats: adaptiveFormats
                    .concat(regularFormats)
                    .map(f => f.itag)
            });
            throw new Error(`Format with itag ${options.quality} not found`);
        }
        
        // Download the requested format
        logger.info('Downloading format', { 
            itag: format.itag,
            hasVideo: format.has_video,
            hasAudio: format.has_audio 
        });
        
        const stream = await yt.download(videoId, {
            type: format.has_video ? 'video' : 'audio',
            quality: format.itag.toString()
        });
        
        return stream;
    } catch (error) {
        logger.error('Stream error', { 
            error: error.message, 
            stack: error.stack,
            url,
            options,
            retryCount
        });
        
        if ((error.message.includes('Status code: 429') || 
             error.message.includes('Sign in to confirm') || 
             error.message.includes('streaming data')) && 
            retryCount < MAX_RETRIES) {
            const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            logger.info(`YouTube API error for download, retrying in ${waitTime}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await delay(waitTime);
            return getVideoStreamWithRetry(url, options, retryCount + 1);
        }
        throw error;
    }
}

// Helper function to choose the best format based on quality criteria
function chooseFormat(formats, options = {}) {
    if (!formats || !formats.length) {
        return null;
    }
    
    // If itag is explicitly specified, find it
    if (options.quality && !isNaN(parseInt(options.quality))) {
        const format = formats.find(f => f.itag === parseInt(options.quality));
        if (format) return format;
    }
    
    // For the "highest" quality option, simply return the first format
    // since our formats are already sorted by quality
    if (options.quality === 'highest') {
        return formats[0];
    }
    
    // For "lowest" quality, return the last format
    if (options.quality === 'lowest') {
        return formats[formats.length - 1];
    }
    
    // If quality contains a specific quality label (like "720p"), find a matching format
    if (options.quality && typeof options.quality === 'string') {
        const format = formats.find(f => 
            f.quality && f.quality.toString().includes(options.quality));
        if (format) return format;
    }
    
    // Default to the highest quality format
    return formats[0];
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