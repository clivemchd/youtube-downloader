const request = require('supertest');
const app = require('./server');

describe('YouTube Downloader API', () => {
    // Test video URL - using a short, public domain video
    const testVideoUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

    describe('GET /video-info', () => {
        it('should return video information for valid URL', async () => {
            const response = await request(app)
                .get('/video-info')
                .query({ url: testVideoUrl });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('title');
            expect(response.body).toHaveProperty('formats');
            expect(response.body).toHaveProperty('videoDetails');
            expect(Array.isArray(response.body.formats)).toBe(true);
        }, 30000); // Increased timeout for YouTube API calls

        it('should return error for invalid URL', async () => {
            const response = await request(app)
                .get('/video-info')
                .query({ url: 'https://youtube.com/invalid' });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });

        it('should return error when no URL provided', async () => {
            const response = await request(app)
                .get('/video-info');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('No URL provided');
        });

        it('should handle audio-only format requests', async () => {
            const response = await request(app)
                .get('/video-info')
                .query({ 
                    url: testVideoUrl,
                    type: 'audio'
                });

            expect(response.status).toBe(200);
            expect(response.body.formats).toBeDefined();
            expect(response.body.formats.length).toBeGreaterThan(0);
            // Check if all formats are audio-only
            response.body.formats.forEach(format => {
                expect(format).toHaveProperty('audioQuality');
                expect(format).toHaveProperty('bitrate');
            });
        }, 30000);
    });

    describe('GET /download', () => {
        it('should initiate video download for valid URL and itag', async () => {
            // First get video info to get a valid itag
            const infoResponse = await request(app)
                .get('/video-info')
                .query({ url: testVideoUrl });

            const validItag = infoResponse.body.formats[0].itag;

            // Create a new request but don't wait for the full response
            const response = await request(app)
                .get('/download')
                .query({ 
                    url: testVideoUrl,
                    itag: validItag
                })
                .buffer(false) // Don't buffer the response
                .parse((res, cb) => {
                    // Only check headers and abort
                    res.on('data', () => {
                        res.destroy();
                    });
                    cb(null, res);
                });

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toMatch(/video\/mp4|audio\/mpeg/);
            expect(response.headers['content-disposition']).toBeDefined();
        }, 10000);

        it('should return error for missing URL', async () => {
            // Use a separate agent to avoid EPIPE errors
            const agent = request.agent(app);
            
            const response = await agent
                .get('/download')
                .query({ itag: '18' })
                .set('Connection', 'close'); // Ensure connection is closed properly

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Missing URL or quality selection');
        });

        it('should return error for missing itag', async () => {
            const response = await request(app)
                .get('/download')
                .query({ url: testVideoUrl });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Missing URL or quality selection');
        });

        it('should handle audio downloads', async () => {
            // First get video info to get a valid audio itag
            const infoResponse = await request(app)
                .get('/video-info')
                .query({ 
                    url: testVideoUrl,
                    type: 'audio'
                });

            const validAudioItag = infoResponse.body.formats[0].itag;

            // Create a new request but don't wait for the full response
            const response = await request(app)
                .get('/download')
                .query({ 
                    url: testVideoUrl,
                    itag: validAudioItag,
                    type: 'audio'
                })
                .buffer(false) // Don't buffer the response
                .parse((res, cb) => {
                    // Only check headers and abort
                    res.on('data', () => {
                        res.destroy();
                    });
                    cb(null, res);
                });

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('audio/mpeg');
            expect(response.headers['content-disposition']).toContain('.mp3');
        }, 30000);
    });

    describe('Rate Limiting', () => {
        it('should limit video info requests', async () => {
            // Make more requests than the limit allows
            const requests = Array(101).fill().map(() => 
                request(app)
                    .get('/video-info')
                    .query({ url: testVideoUrl })
            );

            const responses = await Promise.all(requests);
            
            // At least one response should be rate limited
            const rateLimited = responses.some(response => response.status === 429);
            expect(rateLimited).toBe(true);
        }, 60000);

        it('should limit download requests', async () => {
            // Make more requests than the limit allows
            const requests = Array(11).fill().map(() => 
                request(app)
                    .get('/download')
                    .query({ 
                        url: testVideoUrl,
                        itag: '18'
                    })
                    .buffer(false)
                    .parse((res, cb) => {
                        res.on('data', () => {
                            res.destroy();
                        });
                        cb(null, res);
                    })
            );

            const responses = await Promise.all(requests);
            
            // At least one response should be rate limited
            const rateLimited = responses.some(response => response.status === 429);
            expect(rateLimited).toBe(true);
        }, 60000);
    });
}); 