const logger = require('./logger');

class CustomReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
    this.testResults = [];
    this.startTime = null;
  }

  onRunStart(results, options) {
    this.startTime = new Date();
    logger.info('\n\n');
    logger.info('='.repeat(80));
    logger.info('🚀 STARTING YOUTUBE DOWNLOADER TESTS');
    logger.info('='.repeat(80));
    logger.info('\n');
  }

  onTestStart(test) {
    logger.info(`🔍 Running: ${test.path.split('/').pop()} - ${test.title}`);
  }

  onTestResult(test, testResult, aggregatedResult) {
    this.testResults.push(testResult);
    
    const { numPassingTests, numFailingTests, numPendingTests, testResults } = testResult;
    
    logger.info('\n');
    logger.info('-'.repeat(80));
    logger.info(`📋 Test File: ${test.path.split('/').pop()}`);
    logger.info(`✅ Passed: ${numPassingTests}, ❌ Failed: ${numFailingTests}, ⏸️ Pending: ${numPendingTests}`);
    logger.info('-'.repeat(80));
    
    testResults.forEach(result => {
      const status = result.status === 'passed' ? '✅ PASS' : result.status === 'failed' ? '❌ FAIL' : '⏸️ SKIP';
      const duration = (result.duration / 1000).toFixed(2);
      logger.info(`${status} - ${result.title} (${duration}s)`);
      
      if (result.status === 'failed') {
        logger.info('\n');
        logger.info('  Error Details:');
        result.failureMessages.forEach(message => {
          const cleanMessage = message.split('\n').slice(0, 3).join('\n');
          logger.info(`  ${cleanMessage}`);
        });
        logger.info('\n');
      }
    });
  }

  onRunComplete(contexts, results) {
    const endTime = new Date();
    const duration = (endTime - this.startTime) / 1000;
    
    logger.info('\n');
    logger.info('='.repeat(80));
    logger.info('📊 TEST SUMMARY');
    logger.info('='.repeat(80));
    logger.info(`Total Test Suites: ${results.numTotalTestSuites}`);
    logger.info(`Total Tests: ${results.numTotalTests}`);
    logger.info(`Passed: ${results.numPassedTests}`);
    logger.info(`Failed: ${results.numFailedTests}`);
    logger.info(`Pending: ${results.numPendingTests}`);
    logger.info(`Time: ${duration.toFixed(2)}s`);
    
    if (results.numFailedTests > 0) {
      logger.info('\n');
      logger.info('❌ FAILED TESTS:');
      this.testResults.forEach(testResult => {
        testResult.testResults.forEach(result => {
          if (result.status === 'failed') {
            logger.info(`- ${result.fullName}`);
          }
        });
      });
    }
    
    logger.info('\n');
    logger.info('='.repeat(80));
    logger.info(`🏁 FINISHED ${results.numFailedTests === 0 ? '✅ SUCCESS' : '❌ FAILURE'}`);
    logger.info('='.repeat(80));
    logger.info('\n');
    
    if (results.numFailedTests === 0) {
      logger.info('🎉 All tests passed! Your YouTube Downloader is working correctly.');
    } else {
      logger.info('⚠️ Some tests failed. Please check the error details above.');
    }
    logger.info('\n');
    logger.info('📝 HTML report generated at: ./test-report.html');
    logger.info('\n');
  }
}

module.exports = CustomReporter; 