module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: "v8",

  // A list of reporter names that Jest uses when writing coverage reports
  reporters: [
    "default",
    ["./custom-reporter.js", {}],
    ["jest-html-reporter", {
      "pageTitle": "YouTube Downloader Test Report",
      "outputPath": "./test-report.html",
      "includeFailureMsg": true
    }]
  ],

  // The test environment that will be used for testing
  testEnvironment: "node",

  // The glob patterns Jest uses to detect test files
  testMatch: [
    "**/__tests__/**/*.[jt]s?(x)",
    "**/?(*.)+(spec|test).[tj]s?(x)"
  ],

  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: [
    "/node_modules/",
    "/tests/e2e/"
  ],

  // Indicates whether each individual test should be reported during the run
  verbose: true,

  // Setup files to run before each test
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
}; 