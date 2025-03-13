// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Download Functionality', () => {
  // Valid YouTube URL for testing
  const validYouTubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
  
  test('should initiate download process', async ({ page }) => {
    await page.goto('/');
    
    // Enter a valid YouTube URL
    await page.fill('#videoUrl', validYouTubeUrl);
    
    // Click the Get Info button
    await page.click('#getInfoBtn');
    
    // Wait for the video info to be displayed
    await page.waitForSelector('#videoInfo:not(.hidden)', { timeout: 10000 });
    
    // Mock the actual download to avoid large file transfers during testing
    await page.route('**/download**', async (route) => {
      // Wait a bit to simulate download start
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock response headers
      const headers = {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="test-video.mp4"',
        'Content-Length': '1000000'
      };
      
      // Return a small mock response instead of the actual video
      await route.fulfill({
        status: 200,
        headers: headers,
        body: Buffer.from('Mock video content')
      });
    });
    
    // Start the download
    await page.click('#downloadBtn');
    
    // Check if the download progress is displayed
    const downloadProgress = page.locator('#downloadProgress');
    await expect(downloadProgress).toBeVisible();
    
    // Check if the progress bar is visible
    const progressBar = page.locator('#progressBar');
    await expect(progressBar).toBeVisible();
    
    // Check if the download status is updated
    const downloadStatus = page.locator('#downloadStatus');
    await expect(downloadStatus).toBeVisible();
    
    // Wait for the download to complete (or at least start)
    await page.waitForTimeout(2000);
  });
  
  test('should handle download errors', async ({ page }) => {
    await page.goto('/');
    
    // Enter a valid YouTube URL
    await page.fill('#videoUrl', validYouTubeUrl);
    
    // Click the Get Info button
    await page.click('#getInfoBtn');
    
    // Wait for the video info to be displayed
    await page.waitForSelector('#videoInfo:not(.hidden)', { timeout: 10000 });
    
    // Mock a failed download
    await page.route('**/download**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Download failed',
          details: 'Mock error for testing'
        })
      });
    });
    
    // Start the download
    await page.click('#downloadBtn');
    
    // Check if the error message is displayed
    const errorElement = page.locator('#error');
    await expect(errorElement).toBeVisible();
    await expect(errorElement).toContainText('Mock error for testing');
  });
}); 