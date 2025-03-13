const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');

// Cache for proxies
let proxyCache = {
  proxies: [],
  lastUpdated: 0,
  isUpdating: false
};

// Configuration
const PROXY_UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes
const PROXY_URL = 'https://free-proxy-list.net/';
const MAX_PROXY_AGE = 30 * 60 * 1000; // 30 minutes

/**
 * Scrapes proxies from free-proxy-list.net
 * @returns {Promise<Array<{ip: string, port: string, protocol: string, anonymity: string, country: string, https: boolean}>>}
 */
async function scrapeProxies() {
  try {
    logger.info('Scraping proxies from free-proxy-list.net');
    const response = await axios.get(PROXY_URL);
    const $ = cheerio.load(response.data);
    
    const proxies = [];
    
    // Find the table with proxies
    $('table tbody tr').each((index, element) => {
      const tds = $(element).find('td');
      
      const ip = $(tds[0]).text();
      const port = $(tds[1]).text();
      const country = $(tds[2]).text();
      const anonymity = $(tds[4]).text();
      const https = $(tds[6]).text().trim() === 'yes';
      
      // Only include proxies that support HTTPS
      if (https) {
        proxies.push({
          ip,
          port,
          protocol: 'https',
          anonymity,
          country,
          https,
          url: `https://${ip}:${port}`
        });
      }
    });
    
    logger.info(`Successfully scraped ${proxies.length} proxies`);
    return proxies;
  } catch (error) {
    logger.error('Error scraping proxies:', error.message);
    return [];
  }
}

/**
 * Updates the proxy cache if needed
 * @returns {Promise<void>}
 */
async function updateProxiesIfNeeded() {
  const now = Date.now();
  
  // If we're already updating or the cache is fresh, return
  if (proxyCache.isUpdating || (now - proxyCache.lastUpdated < PROXY_UPDATE_INTERVAL && proxyCache.proxies.length > 0)) {
    return;
  }
  
  try {
    proxyCache.isUpdating = true;
    const proxies = await scrapeProxies();
    
    if (proxies.length > 0) {
      proxyCache.proxies = proxies;
      proxyCache.lastUpdated = now;
    }
  } catch (error) {
    logger.error('Error updating proxies:', error.message);
  } finally {
    proxyCache.isUpdating = false;
  }
}

/**
 * Gets a random proxy from the cache
 * @returns {string|null} Proxy URL or null if no proxies available
 */
function getRandomProxy() {
  if (proxyCache.proxies.length === 0) {
    return null;
  }
  
  const randomIndex = Math.floor(Math.random() * proxyCache.proxies.length);
  return proxyCache.proxies[randomIndex].url;
}

/**
 * Gets the current proxy list
 * @returns {Array} List of proxies
 */
function getProxyList() {
  return proxyCache.proxies;
}

/**
 * Gets the last updated timestamp
 * @returns {number} Timestamp when proxies were last updated
 */
function getLastUpdated() {
  return proxyCache.lastUpdated;
}

/**
 * Forces an update of the proxy list
 * @returns {Promise<Array>} Updated proxy list
 */
async function forceProxyUpdate() {
  try {
    const proxies = await scrapeProxies();
    
    if (proxies.length > 0) {
      proxyCache.proxies = proxies;
      proxyCache.lastUpdated = Date.now();
    }
    
    return proxyCache.proxies;
  } catch (error) {
    logger.error('Error forcing proxy update:', error.message);
    return proxyCache.proxies;
  }
}

// Initialize proxies on module load
updateProxiesIfNeeded();

module.exports = {
  updateProxiesIfNeeded,
  getRandomProxy,
  getProxyList,
  getLastUpdated,
  forceProxyUpdate
}; 