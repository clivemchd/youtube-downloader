// Mock the logger during tests to prevent console output
jest.mock('./logger', () => {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };
}); 