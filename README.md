# YouTube Video Downloader

A powerful Node.js application for downloading YouTube videos and audio with quality selection, built with Express.js.

## Features

- **Video Downloads**: Download YouTube videos in various quality options
- **Audio Downloads**: Extract audio from YouTube videos and convert to MP3
- **HD Video Support**: Download high-definition videos with merged audio and video streams
- **Quality Selection**: Choose from available video and audio quality options
- **Anti-Bot Protection Bypass**: Uses modern YouTube API client to bypass "Sign in to confirm you're not a bot" errors
- **Rate Limiting**: Prevents abuse with configurable request limits
- **Comprehensive Logging**: Detailed logs for debugging and monitoring
- **Robust Error Handling**: Graceful handling of errors and edge cases
- **Clean Test Reports**: Visual test reports for development
- **Environment Configuration**: Separate development, reference, and production settings
- **Render.com Ready**: Optimized for deployment on Render.com

## Technology Stack

- **Backend**: Node.js with Express
- **Video Processing**: FFmpeg for video/audio manipulation
- **YouTube API**: youtubei.js for YouTube video extraction
- **Logging**: Winston for structured logging
- **Testing**: Jest and Supertest for automated testing
- **Environment**: dotenv for environment configuration

## Anti-Bot Protection

YouTube has implemented anti-bot measures that require users to verify they are not robots by signing in. This application uses the `youtubei.js` library to bypass these restrictions without requiring user authentication. The implementation:

- Uses Innertube API endpoints directly rather than scraping
- Handles YouTube's "Sign in to confirm you're not a bot" errors automatically 
- Provides more reliable access to video streams and metadata
- Implements proper retry mechanisms for intermittent errors

This approach allows the application to download videos reliably without requiring user authentication or dealing with CAPTCHAs.

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

3. Create environment configuration:
   ```
   cp .env.example .env
   ```

4. Start the server:
   ```
   npm start
   ```

The server will start on port 3000 by default.

## Environment Configuration

The application uses environment variables to distinguish between development, reference, and production environments:

```
# .env.example
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
DOWNLOAD_LIMIT_WINDOW_MS=3600000
DOWNLOAD_LIMIT_MAX_REQUESTS=10
```

For production, you can create a `.env.prod` file based on the provided `.env.prod.example`:

```
# .env.prod
PRODUCTION_API_URL=https://your-production-domain.com  # Required: Set to your production API URL
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
# ... other variables
```

For reference environment (production-like with localhost), use `.env.ref`:

```
# .env.ref
NODE_ENV=ref
API_URL=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
DOWNLOAD_LIMIT_WINDOW_MS=3600000
DOWNLOAD_LIMIT_MAX_REQUESTS=10
```

Key environment variables:

- `NODE_ENV`: Set to "development" for local development, "ref" for reference environment, or "production" for production deployment
- `PRODUCTION_API_URL`: The base URL for API endpoints in production (required)
  - This URL is automatically injected into the frontend code during the build process
  - In development mode, the frontend uses `http://localhost:3000` by default
  - In reference mode, the frontend uses `http://localhost:3000`
  - In production mode, the frontend uses the `PRODUCTION_API_URL` value
- `PORT`: The port the server will listen on (Render.com will set this automatically)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `RATE_LIMIT_*`: Rate limiting configuration for video info endpoint
- `DOWNLOAD_LIMIT_*`: Rate limiting configuration for download endpoint

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
- **Environment-specific**: More verbose in development, more concise in production

## Testing

The application includes comprehensive tests to ensure functionality:

```bash
npm test
```

This will run Jest tests that verify:
- API responses for valid and invalid URLs
- Video download initiation
- Audio-only format handling
- Rate limiting functionality

### Test Notes

- Tests use a public domain video for validation
- Network errors (like EPIPE) are properly handled in tests
- An HTML test report is generated at `./test-report.html`
- Tests include proper cleanup of resources

For end-to-end testing, the application uses mocked responses to avoid actual downloads during testing.

### End-to-End Testing

The application includes end-to-end tests for the frontend using Playwright:

```
npm run test:e2e
```

To run the tests with the Playwright UI:

```
npm run test:e2e:ui
```

To debug the tests:

```
npm run test:e2e:debug
```

To run tests in a specific browser:

```
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=firefox
npm run test:e2e -- --project=webkit
```

End-to-end test features include:
- Testing the homepage UI elements
- Testing video information retrieval
- Testing the download functionality
- Testing error handling
- Cross-browser testing (Chromium, Firefox, and WebKit)
- Mocking network requests to avoid actual downloads
- Visual testing with screenshots on failure

## Rate Limiting

To prevent abuse, the application implements rate limiting:

- Video Info: 100 requests per 15 minutes per IP
- Downloads: 10 downloads per hour per IP

Rate limits can be configured via environment variables.

## Error Handling

The application includes robust error handling for:
- Invalid URLs
- Missing parameters
- Stream errors
- FFmpeg processing errors
- Client disconnections

## Development

### Available Scripts

- `npm start`: Start the server in default mode
- `npm run dev`: Start the server in development mode
- `npm run ref`: Build and start the server in reference mode (production-like with localhost)
- `npm run prod`: Build and start the server in production mode
- `npm run build`: Build the frontend
- `npm run build:dev`: Build the frontend in development mode
- `npm run build:ref`: Build the frontend in reference mode
- `npm run build:prod`: Build the frontend in production mode
- `npm test`: Run Jest tests
- `npm run test:e2e`: Run end-to-end tests
- `npm run test:e2e:ui`: Run end-to-end tests with UI
- `npm run test:e2e:debug`: Run end-to-end tests in debug mode
- `npm run test:ref`: Run end-to-end tests against the reference build

### Project Structure

```
youtube-download/
├── dist/                  # Minified and obfuscated files for production
├── logs/                  # Log files
├── public/                # Static frontend files (development)
├── temp/                  # Temporary files for processing
├── tests/                 # Test files
│   └── e2e/               # End-to-end tests with Playwright
├── build.js               # Build script for frontend minification
├── server.js              # Main application file
├── logger.js              # Logging configuration
├── server.test.js         # API tests with Jest
├── jest.config.js         # Jest configuration
├── playwright.config.js   # Playwright configuration
├── custom-reporter.js     # Custom test reporter
├── jest.setup.js          # Test setup
├── .env                   # Development environment variables (not committed)
├── .env.example           # Example environment variables for development
├── .env.prod              # Production environment variables (not committed)
├── .env.prod.example      # Example environment variables for production
├── .env.ref               # Reference environment variables (not committed)
├── package.json           # Dependencies and scripts
└── README.md              # Documentation
```

### Running in Development Mode

```
npm run dev
```

### Building the Frontend

The application includes a build process that minifies and obfuscates the frontend code in production mode:

```
# Build for development (copies files without minification)
npm run build:dev

# Build for production (minifies and obfuscates)
npm run build:prod

# Build and run in production mode
npm run prod
```

The build process automatically injects environment variables into the frontend code, allowing you to configure the API URL for different environments. In production, you must specify the `PRODUCTION_API_URL` in your `.env.prod` file.

### Important Build Notes

1. When setting `PRODUCTION_API_URL` in `.env.prod`, any trailing slashes will be automatically removed to prevent double slashes in API calls.
2. Function names referenced in HTML attributes (like `onclick="getVideoInfo()"`) are preserved during minification.
3. The build process handles both standalone JavaScript files and inline JavaScript in HTML files.
4. Environment variables are automatically injected into the frontend code:
   - The `API_URL` constant in the frontend JavaScript is automatically replaced with the appropriate URL based on the environment
   - In development mode, it uses `http://localhost:3000` by default
   - In reference mode, it uses `http://localhost:3000`
   - In production mode, it uses the `PRODUCTION_API_URL` from `.env.prod`
   - This ensures that API calls are always made to the correct endpoint based on the environment

#### Minification and Obfuscation Features

The build process includes advanced minification and obfuscation techniques:

- **HTML Minification**: 
  - Removes whitespace, comments, and unnecessary attributes
  - Minifies inline CSS and JavaScript
  - Removes optional tags and attribute quotes
  - Sorts attributes and class names for better gzip compression

- **CSS Minification**: 
  - Compresses styles by removing whitespace and comments
  - Optimizes property values and units
  - Merges compatible selectors

- **JavaScript Obfuscation**: 
  - Variable and function name mangling (renames to short, meaningless names)
  - Property name mangling (except for DOM properties)
  - Dead code elimination and tree shaking
  - Multiple compression passes for maximum size reduction
  - Boolean and math optimizations
  - String transformations (converts strings to character codes)
  - Control flow flattening
  - Advanced code transformations for browser compatibility

These techniques significantly reduce file sizes (up to 65% reduction) and make the code more difficult to reverse-engineer, providing better protection for your intellectual property. The obfuscation is applied to both standalone JavaScript files and inline JavaScript in HTML files.

### Running in Production Mode

```
npm run prod
```

### Running Tests

```
npm test
```

## Deployment to Render.com

This application is optimized for deployment on Render.com:

1. Create a new Web Service on Render.com
2. Connect your GitHub repository
3. Configure the service:
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build:prod`
   - **Start Command**: `NODE_ENV=production node -r dotenv/config server.js`
   - **Environment Variables**: 
     - `PRODUCTION_API_URL`: Set to your Render.com domain (e.g., `https://your-app.onrender.com`)
     - `PORT`: Automatically set by Render.com
     - `NODE_ENV`: Set to `production`
     - Other variables as needed from `.env.prod.example`

### Important Render.com Configuration Notes

- Render automatically sets the `PORT` environment variable, which this application respects
- You must set the `PRODUCTION_API_URL` to your Render.com domain for API calls to work correctly
- For proper logging on Render, logs are also sent to stdout/stderr
- Temporary files are stored in `/tmp` on Render to avoid disk space issues
- Rate limiting is configured to be more strict in production

## License

ISC 