// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Video Information Retrieval', () => {
  // Valid YouTube URL for testing
  const validYouTubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
  
  test('should retrieve video information for a valid URL', async ({ page }) => {
    await page.goto('/');
    
    // Enter a valid YouTube URL
    await page.fill('#videoUrl', validYouTubeUrl);
    
    // Click the Get Info button
    await page.click('#getInfoBtn');
    
    // Wait for the video info to be displayed
    await page.waitForSelector('#videoInfo:not(.hidden)', { timeout: 10000 });
    
    // Check if the video title is displayed
    const videoTitle = page.locator('#videoTitle');
    await expect(videoTitle).toBeVisible();
    await expect(videoTitle).not.toHaveText('');
    
    // Check if quality options are loaded
    const qualitySelect = page.locator('#qualitySelect option');
    const optionCount = await qualitySelect.count();
    expect(optionCount).toBeGreaterThan(0);
    
    // Check if the download button is enabled
    const downloadBtn = page.locator('#downloadBtn');
    await expect(downloadBtn).toBeEnabled();
    await expect(downloadBtn).toHaveText('Download Video');
  });
  
  test('should switch between video and audio formats', async ({ page }) => {
    await page.goto('/');
    
    // Enter a valid YouTube URL
    await page.fill('#videoUrl', validYouTubeUrl);
    
    // Get video formats
    await page.click('#getInfoBtn');
    await page.waitForSelector('#videoInfo:not(.hidden)', { timeout: 10000 });
    
    // Check video mode label
    const qualityLabel = page.locator('#qualityLabel');
    await expect(qualityLabel).toHaveText('Select Video Quality:');
    
    // Store the first video format option text
    const videoFormatText = await page.locator('#qualitySelect option').first().textContent();
    
    // Switch to audio mode
    await page.click('.toggle-slider');
    
    // Wait for the quality options to update
    await page.waitForTimeout(1000);
    
    // Check audio mode label
    await expect(qualityLabel).toHaveText('Select Audio Quality:');
    
    // Store the first audio format option text
    const audioFormatText = await page.locator('#qualitySelect option').first().textContent();
    
    // Verify that video and audio format texts are different
    expect(videoFormatText).not.toEqual(audioFormatText);
    
    // Check if the download button text changed
    const downloadBtn = page.locator('#downloadBtn');
    await expect(downloadBtn).toHaveText('Download Audio');
  });
}); 