# YouTube Video Downloader

A powerful Node.js application for downloading YouTube videos and audio with quality selection, built with Express.js.

## Features

- **Video Downloads**: Download YouTube videos in various quality options
- **Audio Downloads**: Extract audio from YouTube videos and convert to MP3
- **HD Video Support**: Download high-definition videos with merged audio and video streams
- **Quality Selection**: Choose from available video and audio quality options
- **Rate Limiting**: Prevents abuse with configurable request limits
- **Comprehensive Logging**: Detailed logs for debugging and monitoring
- **Robust Error Handling**: Graceful handling of errors and edge cases
- **Clean Test Reports**: Visual test reports for development

## Technology Stack

- **Backend**: Node.js with Express
- **Video Processing**: FFmpeg for video/audio manipulation
- **YouTube API**: @distube/ytdl-core for YouTube video extraction
- **Logging**: Winston for structured logging
- **Testing**: Jest and Supertest for automated testing

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd youtube-download
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

The server will start on port 3000 by default.

## API Endpoints

### Get Video Information

```
GET /video-info?url={youtube-url}&type={video|audio}
```

Parameters:
- `url`: YouTube video URL (required)
- `type`: "video" or "audio" (optional, defaults to "video")

Response:
```json
{
  "title": "Video Title",
  "formats": [
    {
      "itag": 22,
      "quality": "720p",
      "container": "mp4",
      "hasAudio": true,
      "fps": 30,
      "videoCodec": "avc1.64001F",
      "audioCodec": "mp4a.40.2",
      "bitrate": 1500000
    },
    ...
  ],
  "videoDetails": {
    "title": "Video Title",
    "lengthSeconds": "120",
    "author": "Channel Name",
    "videoId": "abc123",
    "isLive": false,
    "thumbnails": [...]
  }
}
```

### Download Video or Audio

```
GET /download?url={youtube-url}&itag={itag}&type={video|audio}
```

Parameters:
- `url`: YouTube video URL (required)
- `itag`: Format identifier from the video info response (required)
- `type`: "video" or "audio" (optional, defaults to "video")

Response:
- Binary stream of the video or audio file

## Logging System

The application uses Winston for structured logging with the following features:

- **Log Levels**: info, error, warn, debug
- **Log Rotation**: 5MB max file size with 5 files retention
- **Log Formats**: JSON format with timestamps and stack traces
- **Log Files**:
  - `logs/combined.log`: All logs
  - `logs/error.log`: Error logs only

## Testing

The application includes comprehensive tests for all endpoints and features:

```
npm test
```

Test features include:
- HTML test reports (`test-report.html`)
- Custom console reporter with clear pass/fail indicators
- Mocked logger during tests
- Proper handling of stream closures

## Rate Limiting

To prevent abuse, the application implements rate limiting:

- Video Info: 100 requests per 15 minutes per IP
- Downloads: 10 downloads per hour per IP

## Error Handling

The application includes robust error handling for:
- Invalid URLs
- Missing parameters
- Stream errors
- FFmpeg processing errors
- Client disconnections

## Development

### Project Structure

```
youtube-download/
├── logs/                  # Log files
├── public/                # Static frontend files
├── temp/                  # Temporary files for processing
├── server.js              # Main application file
├── logger.js              # Logging configuration
├── server.test.js         # API tests
├── jest.config.js         # Jest configuration
├── custom-reporter.js     # Custom test reporter
├── jest.setup.js          # Test setup
├── package.json           # Dependencies and scripts
└── README.md              # Documentation
```

### Running in Development Mode

```
npm start
```

### Running Tests

```
npm test
```

## License

ISC 