const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { minify: minifyHtml } = require('html-minifier-terser');
const logger = require('./logger');

// Configuration
const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'dist');
const isProduction = process.env.NODE_ENV === 'production';
const isRef = process.env.NODE_ENV === 'ref';

// Define environment-specific variables
const ENV_VARS = {
  API_URL: (process.env.API_URL || (
    isProduction 
      ? process.env.PRODUCTION_API_URL || 'https://youdownloadtube.onrender.com'
      : isRef
        ? 'http://localhost:9000'
        : 'http://localhost:9000'
  )).replace(/\/+$/, '') // Remove trailing slashes
};

logger.info(`Building with API_URL: ${ENV_VARS.API_URL} for environment: ${process.env.NODE_ENV || 'development'}`);

// JavaScript minification and obfuscation options
const jsMinifyOptions = {
  compress: {
    drop_console: isProduction || isRef, // Drop console in both prod and ref
    drop_debugger: isProduction || isRef,
    booleans_as_integers: false,
    passes: 2,
    unsafe: false,
    unsafe_math: false,
    unsafe_methods: false,
    unsafe_proto: false,
    unsafe_regexp: false,
    unsafe_undefined: false,
    sequences: true,
    dead_code: true,
    conditionals: true,
    evaluate: true,
    if_return: true,
    join_vars: true,
    collapse_vars: true,
    reduce_vars: true,
    hoist_props: true,
    computed_props: true
  },
  mangle: {
    toplevel: false,
    reserved: ['getVideoInfo', 'downloadVideo'],
    properties: false,
    safari10: true
  },
  format: {
    ascii_only: true,
    beautify: false,
    comments: false,
    indent_level: 0,
    max_line_len: 500,
    webkit: true,
    semicolons: true,
    braces: true
  },
  sourceMap: false,
  ecma: 2020,
  toplevel: false,
  ie8: false,
  keep_classnames: false,
  keep_fnames: true,
  safari10: true,
  nameCache: null
};

// HTML minification options
const htmlMinifyOptions = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
  minifyCSS: true,
  minifyJS: false,
  minifyURLs: true,
  removeAttributeQuotes: false,
  removeEmptyAttributes: true,
  removeOptionalTags: false,
  removeTagWhitespace: false,
  sortAttributes: true,
  sortClassName: true,
  decodeEntities: true
};

// Create dist directory if it doesn't exist
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  logger.info(`Created distribution directory: ${DIST_DIR}`);
}

// Process HTML files
async function processHtmlFile(filePath) {
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath);
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (isProduction) {
      // Process inline JavaScript first
      content = await processInlineJs(filePath);
      
      // Then minify the entire HTML
      const minifiedContent = await minifyHtml(content, htmlMinifyOptions);
      fs.writeFileSync(outputPath, minifiedContent);
      logger.info(`Minified HTML: ${relativePath}`);
    } else {
      // Just copy in development
      fs.writeFileSync(outputPath, content);
      logger.info(`Copied HTML: ${relativePath}`);
    }
  } catch (error) {
    logger.error(`Error processing HTML file ${relativePath}:`, error);
  }
}

// Function to inject environment variables into JavaScript
function injectEnvVars(code) {
  let result = code;
  
  // Replace API_URL with the environment-specific value
  // Using a more robust regex that will match the API_URL declaration regardless of spacing
  result = result.replace(
    /const\s+API_URL\s*=\s*(['"])([^'"]*)\1/,
    `const API_URL = "${ENV_VARS.API_URL}"`
  );
  
  logger.info(`Injected API_URL: ${ENV_VARS.API_URL}`);
  return result;
}

// Extract and process inline JavaScript from HTML
async function processInlineJs(htmlFilePath) {
  const content = fs.readFileSync(htmlFilePath, 'utf8');
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  let modifiedContent = content;
  
  while ((match = scriptRegex.exec(content)) !== null) {
    const scriptContent = match[1];
    
    // Check if the script contains API_URL
    const hasApiUrl = /const\s+API_URL\s*=/.test(scriptContent);
    if (hasApiUrl) {
      logger.info(`Found API_URL in ${path.basename(htmlFilePath)}`);
    }
    
    if (isProduction) {
      try {
        // Inject environment variables before minification
        const envInjectedCode = injectEnvVars(scriptContent);
        
        // Verify API_URL was replaced
        if (hasApiUrl && !envInjectedCode.includes(ENV_VARS.API_URL)) {
          logger.warn(`API_URL replacement may have failed in ${path.basename(htmlFilePath)}`);
        }
        
        const minified = await minify(envInjectedCode, jsMinifyOptions);
        const obfuscatedCode = applyStringObfuscation(minified.code);
        
        modifiedContent = modifiedContent.replace(scriptContent, obfuscatedCode);
        logger.info(`Minified and obfuscated inline JS in ${path.basename(htmlFilePath)}`);
      } catch (error) {
        logger.error(`Error minifying inline JS in ${htmlFilePath}:`, error);
      }
    } else {
      // In development, just inject environment variables without minification
      const envInjectedCode = injectEnvVars(scriptContent);
      
      // Verify API_URL was replaced
      if (hasApiUrl && !envInjectedCode.includes(ENV_VARS.API_URL)) {
        logger.warn(`API_URL replacement may have failed in ${path.basename(htmlFilePath)}`);
      }
      
      modifiedContent = modifiedContent.replace(scriptContent, envInjectedCode);
      logger.info(`Injected environment variables in ${path.basename(htmlFilePath)}`);
    }
  }
  
  return modifiedContent;
}

// Process JavaScript files
async function processJsFile(filePath) {
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (isProduction) {
      // Minify and obfuscate JS in production
      const minified = await minify(content, jsMinifyOptions);
      
      // Apply additional string obfuscation
      const obfuscatedCode = applyStringObfuscation(minified.code);
      
      fs.writeFileSync(outputPath, obfuscatedCode);
      logger.info(`Minified and obfuscated JS: ${relativePath}`);
    } else {
      // Just copy in development
      fs.writeFileSync(outputPath, content);
      logger.info(`Copied JS: ${relativePath}`);
    }
  } catch (error) {
    logger.error(`Error processing JS file ${relativePath}:`, error);
  }
}

// Apply additional string obfuscation
function applyStringObfuscation(code) {
  // Disable string obfuscation completely
  return code;
  
  // Original implementation below, commented out
  /*
  // Find string literals in the code
  const stringRegex = /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g;
  
  // Only obfuscate strings longer than 3 characters to avoid breaking the code
  return code.replace(stringRegex, (match) => {
    // Skip short strings, strings that look like they might be part of a URL or API endpoint,
    // strings that contain function names used in HTML attributes, or the API_URL
    if (match.length <= 5 || 
        match.includes('http') || 
        match.includes('/') || 
        match.includes('\\') ||
        match.includes('getVideoInfo') ||
        match.includes('downloadVideo') ||
        match.includes(ENV_VARS.API_URL)) {
      return match;
    }
    
    // Remove quotes
    const str = match.substring(1, match.length - 1);
    
    // Skip empty strings
    if (!str) return match;
    
    // Convert to array of char codes and join with commas
    const charCodes = Array.from(str).map(c => c.charCodeAt(0));
    
    // Create a string that will be decoded at runtime
    return `String.fromCharCode(${charCodes.join(',')})`;
  });
  */
}

// Process CSS files
function processCssFile(filePath) {
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (isProduction) {
      // Basic CSS minification (remove comments and whitespace)
      const minifiedContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
        .replace(/\s+/g, ' ')             // Collapse whitespace
        .replace(/\s*({|}|;|,|:)\s*/g, '$1') // Remove spaces around special chars
        .trim();
      
      fs.writeFileSync(outputPath, minifiedContent);
      logger.info(`Minified CSS: ${relativePath}`);
    } else {
      // Just copy in development
      fs.writeFileSync(outputPath, content);
      logger.info(`Copied CSS: ${relativePath}`);
    }
  } catch (error) {
    logger.error(`Error processing CSS file ${relativePath}:`, error);
  }
}

// Copy other files (images, etc.)
function copyFile(filePath) {
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath);
  
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.copyFileSync(filePath, outputPath);
    logger.info(`Copied file: ${relativePath}`);
  } catch (error) {
    logger.error(`Error copying file ${relativePath}:`, error);
  }
}

// Process all files in the public directory
async function processDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      
      if (ext === '.html') {
        await processHtmlFile(fullPath);
      } else if (ext === '.js') {
        await processJsFile(fullPath);
      } else if (ext === '.css') {
        processCssFile(fullPath);
      } else {
        copyFile(fullPath);
      }
    }
  }
}

// Main build function
async function build() {
  const startTime = Date.now();
  
  logger.info(`Starting build process in ${isProduction ? 'production' : 'development'} mode`);
  
  try {
    // Clean dist directory
    if (fs.existsSync(DIST_DIR)) {
      fs.rmSync(DIST_DIR, { recursive: true, force: true });
      fs.mkdirSync(DIST_DIR, { recursive: true });
      logger.info(`Cleaned and recreated distribution directory: ${DIST_DIR}`);
    }
    
    // Process all files
    await processDirectory(PUBLIC_DIR);
    
    const endTime = Date.now();
    logger.info(`Build completed in ${(endTime - startTime) / 1000} seconds`);
  } catch (error) {
    logger.error('Build failed:', error);
    process.exit(1);
  }
}

// Run the build
build(); 