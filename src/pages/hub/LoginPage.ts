import { expect, type Locator, type Page } from '@playwright/test';

/** Hub login + company selection. Used once per run by tests/hub-e2e/auth.setup.ts. */
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly companySearch: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.signInButton = page.locator('button[name="login"]');
    this.companySearch = page.locator('input[placeholder="Search..."]').first();
  }

  /** Opens {HUB_URL}en/auth/login (baseURL = HUB_URL from .env, set in playwright.config.ts). */
  async goto() {
    await this.page.goto('en/auth/login');
  }

  /** Fills email + password, clicks Sign in, waits for the company picker (/auth/company). */
  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
    await expect(this.page).toHaveURL(/\/auth\/company/);
  }

  /** Searches the company by name and clicks it; waits for the orders page. */
  async selectCompany(companyName: string) {
    await this.companySearch.fill(companyName);
    await this.page.getByText(companyName).first().click();
    await expect(this.page).toHaveURL(/cms\/orders/);
  }
}
