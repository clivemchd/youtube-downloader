// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('YouTube Downloader Homepage', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    
    // Check if the title is correct
    await expect(page).toHaveTitle('YouTube Video Downloader');
    
    // Check if the main heading is present
    const heading = page.locator('h1');
    await expect(heading).toHaveText('YouTube Downloader');
    
    // Check if the URL input field is present
    const urlInput = page.locator('#videoUrl');
    await expect(urlInput).toBeVisible();
    
    // Check if the Get Info button is present
    const getInfoBtn = page.locator('#getInfoBtn');
    await expect(getInfoBtn).toBeVisible();
    await expect(getInfoBtn).toHaveText('Get Info');
    
    // Check if the toggle switch is present
    const toggleSwitch = page.locator('.toggle-switch');
    await expect(toggleSwitch).toBeVisible();
  });

  test('should show error for empty URL', async ({ page }) => {
    await page.goto('/');
    
    // Click the Get Info button without entering a URL
    await page.click('#getInfoBtn');
    
    // Check if the error message is displayed
    const errorElement = page.locator('#error');
    await expect(errorElement).toBeVisible();
    await expect(errorElement).toHaveText('Please enter a YouTube URL');
  });

  test('should show error for invalid URL', async ({ page }) => {
    await page.goto('/');
    
    // Enter an invalid URL
    await page.fill('#videoUrl', 'https://example.com');
    
    // Click the Get Info button
    await page.click('#getInfoBtn');
    
    // Check if the error message is displayed
    const errorElement = page.locator('#error');
    await expect(errorElement).toBeVisible();
    await expect(errorElement).toContainText('Failed to fetch video information');
  });

  test('should toggle between video and audio mode', async ({ page }) => {
    await page.goto('/');
    
    // Check initial state (video mode)
    const toggleSwitch = page.locator('#downloadType');
    await expect(toggleSwitch).not.toBeChecked();
    
    // Toggle to audio mode
    await page.click('.toggle-slider');
    await expect(toggleSwitch).toBeChecked();
    
    // Toggle back to video mode
    await page.click('.toggle-slider');
    await expect(toggleSwitch).not.toBeChecked();
  });
}); 