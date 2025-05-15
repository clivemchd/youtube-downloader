require('dotenv').config();
const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

// Get environment variables with defaults
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const DOWNLOAD_LIMIT_WINDOW_MS = parseInt(process.env.DOWNLOAD_LIMIT_WINDOW_MS || '3600000', 10); // 1 hour
const DOWNLOAD_LIMIT_MAX_REQUESTS = parseInt(process.env.DOWNLOAD_LIMIT_MAX_REQUESTS || '10', 10);
const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, 'temp');

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

// Route to get video info
app.get('/video-info', async (req, res) => {
    try {
        const videoURL = req.query.url;
        const type = req.query.type || 'video'; // 'video' or 'audio'
        
        if (!videoURL) {
            throw new Error('No URL provided');
        }

        // Clean and validate the URL
        const videoId = ytdl.getVideoID(videoURL);
        const cleanURL = `https://www.youtube.com/watch?v=${videoId}`;

        logger.info('Fetching video info', { url: cleanURL, type, videoId });
        
        const info = await ytdl.getInfo(cleanURL);
        logger.info('Video info fetched successfully', { videoId });

        // Get available formats based on type
        let formats;
        if (type === 'audio') {
            // Audio-only formats
            formats = info.formats
                .filter(format => format.hasAudio && !format.hasVideo)
                .map(format => ({
                    itag: format.itag,
                    quality: format.audioQuality,
                    container: format.container,
                    audioQuality: format.audioQuality,
                    bitrate: format.bitrate
                }))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        } else {
            // Video formats
            const videoFormats = info.formats
                .filter(format => format.hasVideo)
                .map(format => ({
                    itag: format.itag,
                    quality: format.qualityLabel,
                    container: format.container,
                    hasAudio: format.hasAudio,
                    fps: format.fps,
                    videoCodec: format.videoCodec,
                    audioCodec: format.audioCodec,
                    bitrate: format.bitrate
                }))
                .sort((a, b) => {
                    // Extract numeric values from quality labels (e.g., "1080p" -> 1080)
                    const qualityA = parseInt(a.quality) || 0;
                    const qualityB = parseInt(b.quality) || 0;
                    if (qualityA === qualityB) {
                        // If same resolution, prefer the one with audio
                        if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
                        // If both have or don't have audio, prefer higher FPS
                        return (b.fps || 0) - (a.fps || 0);
                    }
                    return qualityB - qualityA;
                });

            // Group formats by resolution
            formats = Object.values(videoFormats.reduce((acc, format) => {
                const quality = format.quality;
                if (!acc[quality] || (format.hasAudio && !acc[quality].hasAudio)) {
                    acc[quality] = format;
                }
                return acc;
            }, {}));
        }

        logger.info(`Found ${formats.length} valid formats`, { videoId });

        if (formats.length === 0) {
            throw new Error(`No downloadable ${type} formats found for this video`);
        }

        res.json({
            title: info.videoDetails.title,
            formats: formats,
            videoDetails: {
                title: info.videoDetails.title,
                lengthSeconds: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                videoId: info.videoDetails.videoId,
                isLive: info.videoDetails.isLive,
                thumbnails: info.videoDetails.thumbnails
            }
        });
    } catch (error) {
        logger.error('Error in /video-info', { 
            error: error.message,
            stack: error.stack,
            url: req.query.url 
        });
        res.status(400).json({ 
            error: error.message,
            details: 'Failed to fetch video information. Please make sure the URL is correct and the video is available.'
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
        const videoId = ytdl.getVideoID(url);
        const cleanURL = `https://www.youtube.com/watch?v=${videoId}`;

        logger.info('Starting download for:', cleanURL, 'with itag:', itag, 'type:', type);
        
        const info = await ytdl.getInfo(cleanURL);
        const format = ytdl.chooseFormat(info.formats, { quality: itag });
        
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
                // Input from stdin
                '-i', 'pipe:0',
                // Audio codec
                '-c:a', 'libmp3lame',
                // Audio quality (0-9, 0=best)
                '-q:a', '2',
                // Output format
                '-f', 'mp3',
                // Output to stdout
                'pipe:1'
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            // Get audio stream
            audioStream = ytdl(cleanURL, {
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
            audioStream.on('error', (err) => {
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

            // Handle client disconnection
            req.on('close', () => {
                logger.info('Download cancelled by client', { videoId });
                if (audioStream) audioStream.destroy();
                if (ffmpegCommand) ffmpegCommand.kill();
            });
        } else {
            // For video, check if we need to merge streams
            const selectedFormat = info.formats.find(f => f.itag === parseInt(itag));
            
            if (selectedFormat.hasAudio) {
                // If the format has audio, we can stream directly
                ytdl(cleanURL, { quality: itag }).pipe(res);
            } else {
                // If no audio in the video stream, we need to merge with best audio
                logger.info('Merging video and audio streams...');

                // Create FFmpeg command with custom stream handling
                const ffmpeg = require('child_process').spawn(ffmpegPath, [
                    // Video input from stdin
                    '-i', 'pipe:3',
                    // Audio input from stdin
                    '-i', 'pipe:4',
                    // Copy video codec (no re-encode)
                    '-c:v', 'copy',
                    // AAC audio codec
                    '-c:a', 'aac',
                    // Output format
                    '-f', 'mp4',
                    // Movflags for streaming compatibility
                    '-movflags', 'frag_keyframe+empty_moov',
                    // Output to stdout
                    'pipe:1'
                ], {
                    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                    windowsHide: true
                });

                // Get video and audio streams
                videoStream = ytdl(cleanURL, {
                    quality: itag,
                    filter: 'videoonly'
                });

                audioStream = ytdl(cleanURL, {
                    quality: 'highestaudio',
                    filter: 'audioonly'
                });

                // Pipe streams to FFmpeg
                videoStream.pipe(ffmpeg.stdio[3]);
                audioStream.pipe(ffmpeg.stdio[4]);

                // Pipe FFmpeg output to response
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
                videoStream.on('error', (err) => {
                    logger.error('Video stream error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({
                            error: 'Video stream failed',
                            details: err.message
                        });
                    }
                    ffmpeg.kill();
                });

                audioStream.on('error', (err) => {
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
            res.status(400).json({ 
                error: error.message,
                details: 'Failed to download. Please try again or select a different quality.'
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
        logger.info(`@distube/ytdl-core version: ${ytdl.version}`);
    });
} 