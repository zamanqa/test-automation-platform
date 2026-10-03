import { faker } from '@faker-js/faker';
import { env } from '@config/env';

// Random test values. They all start with TEST_DATA_PREFIX (qa_auto_),
// so the rows a run created are easy to find in the database.

export function testEmail(domain = 'gmail.com'): string {
  return `${env.testData.TEST_DATA_PREFIX}${faker.string.alphanumeric(10).toLowerCase()}@${domain}`;
}

/** testName('retailer') → "qa_auto_retailer_ab12cd" */
export function testName(label: string): string {
  return `${env.testData.TEST_DATA_PREFIX}${label}_${faker.string.alphanumeric(6).toLowerCase()}`;
}
