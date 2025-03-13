class CustomReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
    this.testResults = [];
    this.startTime = null;
  }

  onRunStart(results, options) {
    this.startTime = new Date();
    console.log('\n\n');
    console.log('='.repeat(80));
    console.log('🚀 STARTING YOUTUBE DOWNLOADER TESTS');
    console.log('='.repeat(80));
    console.log('\n');
  }

  onTestStart(test) {
    console.log(`🔍 Running: ${test.path.split('/').pop()} - ${test.title}`);
  }

  onTestResult(test, testResult, aggregatedResult) {
    this.testResults.push(testResult);
    
    const { numPassingTests, numFailingTests, numPendingTests, testResults } = testResult;
    
    console.log('\n');
    console.log('-'.repeat(80));
    console.log(`📋 Test File: ${test.path.split('/').pop()}`);
    console.log(`✅ Passed: ${numPassingTests}, ❌ Failed: ${numFailingTests}, ⏸️ Pending: ${numPendingTests}`);
    console.log('-'.repeat(80));
    
    testResults.forEach(result => {
      const status = result.status === 'passed' ? '✅ PASS' : result.status === 'failed' ? '❌ FAIL' : '⏸️ SKIP';
      const duration = (result.duration / 1000).toFixed(2);
      console.log(`${status} - ${result.title} (${duration}s)`);
      
      if (result.status === 'failed') {
        console.log('\n');
        console.log('  Error Details:');
        result.failureMessages.forEach(message => {
          const cleanMessage = message.split('\n').slice(0, 3).join('\n');
          console.log(`  ${cleanMessage}`);
        });
        console.log('\n');
      }
    });
  }

  onRunComplete(contexts, results) {
    const endTime = new Date();
    const duration = (endTime - this.startTime) / 1000;
    
    console.log('\n');
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Test Suites: ${results.numTotalTestSuites}`);
    console.log(`Total Tests: ${results.numTotalTests}`);
    console.log(`Passed: ${results.numPassedTests}`);
    console.log(`Failed: ${results.numFailedTests}`);
    console.log(`Pending: ${results.numPendingTests}`);
    console.log(`Time: ${duration.toFixed(2)}s`);
    
    if (results.numFailedTests > 0) {
      console.log('\n');
      console.log('❌ FAILED TESTS:');
      this.testResults.forEach(testResult => {
        testResult.testResults.forEach(result => {
          if (result.status === 'failed') {
            console.log(`- ${result.fullName}`);
          }
        });
      });
    }
    
    console.log('\n');
    console.log('='.repeat(80));
    console.log(`🏁 FINISHED ${results.numFailedTests === 0 ? '✅ SUCCESS' : '❌ FAILURE'}`);
    console.log('='.repeat(80));
    console.log('\n');
    
    if (results.numFailedTests === 0) {
      console.log('🎉 All tests passed! Your YouTube Downloader is working correctly.');
    } else {
      console.log('⚠️ Some tests failed. Please check the error details above.');
    }
    console.log('\n');
    console.log('📝 HTML report generated at: ./test-report.html');
    console.log('\n');
  }
}

module.exports = CustomReporter; 