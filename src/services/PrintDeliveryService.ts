/**
 * @fileoverview PrintDeliveryService — sends HTML receipt emails to Star Micronics
 * printer device emails via the existing Mailgun provider.
 *
 * Fire-and-forget email delivery. Star printers render HTML from the email body.
 * Uses the Mailgun provider (or whatever email provider is configured) to send.
 *
 * Error classification:
 * - Retryable: network timeouts, 5xx responses
 * - Permanent: invalid email (4xx), auth errors
 *
 * @module services/PrintDeliveryService
 */

import { getEmailProvider } from '../factories/EmailProviderFactory.js';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import type { IPrintJobDocument } from '../domain/models/PrintJob.js';
import type { IPrinterDocument } from '../domain/models/Printer.js';
import { PrinterSettingsRepository } from '../repositories/PrinterSettingsRepository.js';

const log = createLogger('PrintDeliveryService');

/** Result from sending a print job email */
export interface PrintDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** Whether the error is retryable (network/5xx) or permanent (4xx/auth) */
  retryable?: boolean;
}

export class PrintDeliveryService {
  private readonly settingsRepo: PrinterSettingsRepository;

  constructor() {
    this.settingsRepo = new PrinterSettingsRepository();
  }

  /**
   * Resolve the "from" email address for print emails.
   * Priority: PrinterSettings.emailFrom → PRINT_EMAIL_FROM env → EMAIL_FROM_ADDRESS env → default
   */
  private async resolveFromAddress(restaurantId: string): Promise<string> {
    const settings = await this.settingsRepo.findByRestaurant(restaurantId);
    if (settings?.emailFrom) return settings.emailFrom;
    if (env.PRINT_EMAIL_FROM) return env.PRINT_EMAIL_FROM;
    if (env.EMAIL_FROM_ADDRESS) return env.EMAIL_FROM_ADDRESS;
    return `noreply@${env.EMAIL_DOMAIN ?? 'orderchop.com'}`;
  }

  /**
   * Send a print job's HTML receipt to the printer's device email.
   *
   * @param printJob - The print job document (must have receiptHtml populated)
   * @param printer - The target printer (contains device email)
   * @param receiptHtml - The HTML receipt content to send
   * @returns Delivery result with success/error and retryable classification
   */
  async sendPrintJob(
    printJob: IPrintJobDocument,
    printer: IPrinterDocument,
    receiptHtml: string,
  ): Promise<PrintDeliveryResult> {
    const fromAddress = await this.resolveFromAddress(printJob.restaurantId.toString());

    // Star Micronics printers use the email subject as the job name
    const subject = `Order #${printJob.orderId.toString().slice(-6)}`;

    log.info(
      {
        printJobId: printJob._id.toString(),
        printerId: printer._id.toString(),
        to: printer.email,
        from: fromAddress,
      },
      'Sending print job email',
    );

    try {
      const provider = getEmailProvider();
      const result = await provider.sendEmail({
        to: printer.email,
        from: fromAddress,
        subject,
        html: receiptHtml,
        metadata: {
          printJobId: printJob._id.toString(),
          printerId: printer._id.toString(),
          restaurantId: printJob.restaurantId.toString(),
        },
      });

      log.info(
        {
          printJobId: printJob._id.toString(),
          messageId: result.messageId,
        },
        'Print job email sent successfully',
      );

      return { success: true, messageId: result.messageId };
    } catch (err) {
      const error = err as { response?: { status?: number }; message?: string; code?: string };
      const errorMessage = error.message ?? 'Unknown error';

      // Classify error as retryable or permanent
      const retryable = this.isRetryableError(error);

      log.error(
        {
          printJobId: printJob._id.toString(),
          to: printer.email,
          error: errorMessage,
          retryable,
          statusCode: error.response?.status,
        },
        'Print job email send failed',
      );

      return { success: false, error: errorMessage, retryable };
    }
  }

  /**
   * Send a test receipt to verify printer connectivity.
   * Uses sample data so the restaurant can confirm the printer receives and renders HTML.
   *
   * @param printer - The printer to test
   * @param restaurantName - Restaurant name for the test receipt header
   * @returns Delivery result
   */
  async sendTestPrint(
    printer: IPrinterDocument,
    restaurantName: string,
  ): Promise<PrintDeliveryResult> {
    const fromAddress = await this.resolveFromAddress(printer.restaurantId.toString());

    const testHtml = this.generateTestReceiptHtml(restaurantName, printer.name);

    log.info(
      {
        printerId: printer._id.toString(),
        to: printer.email,
      },
      'Sending test print',
    );

    try {
      const provider = getEmailProvider();
      const result = await provider.sendEmail({
        to: printer.email,
        from: fromAddress,
        subject: 'Test Print — OrderChop',
        html: testHtml,
        metadata: {
          printerId: printer._id.toString(),
          type: 'test_print',
        },
      });

      log.info(
        {
          printerId: printer._id.toString(),
          messageId: result.messageId,
        },
        'Test print sent successfully',
      );

      return { success: true, messageId: result.messageId };
    } catch (err) {
      const error = err as { response?: { status?: number }; message?: string };
      const errorMessage = error.message ?? 'Unknown error';

      log.error(
        {
          printerId: printer._id.toString(),
          to: printer.email,
          error: errorMessage,
        },
        'Test print send failed',
      );

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Classify whether an error is retryable.
   * - Network errors (timeout, ECONNREFUSED, etc.) → retryable
   * - 5xx server errors → retryable
   * - 4xx client errors (invalid email, auth) → permanent
   */
  private isRetryableError(error: { response?: { status?: number }; code?: string }): boolean {
    // Network-level errors are retryable
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      return true;
    }

    // HTTP 5xx errors are retryable
    const status = error.response?.status;
    if (status && status >= 500) return true;

    // HTTP 4xx errors are permanent (invalid email, auth failure, etc.)
    if (status && status >= 400 && status < 500) return false;

    // Default: treat unknown errors as retryable (safer to retry than drop)
    return true;
  }

  /**
   * Generate a test receipt HTML for printer connectivity verification.
   */
  private generateTestReceiptHtml(restaurantName: string, printerName: string): string {
    const now = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: 'Courier New', Courier, monospace; font-size: 12px; line-height: 1.4; color: #000; width: 100%; max-width: 320px; margin: 0 auto; padding: 8px;">
  <div style="text-align: center; margin-bottom: 8px;">
    <div style="font-size: 16px; font-weight: bold;">${escapeHtml(restaurantName)}</div>
    <div style="font-size: 11px;">OrderChop Print System</div>
  </div>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <div style="text-align: center;">
    <div style="font-size: 18px; font-weight: bold;">TEST PRINT</div>
    <div style="margin: 8px 0;">
      Printer: ${escapeHtml(printerName)}
    </div>
    <div style="margin: 8px 0;">
      If you can read this, your printer<br/>
      is connected and working correctly.
    </div>
  </div>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <div style="text-align: center;">
    <div style="font-size: 14px; font-weight: bold;">Sample Order #00042</div>
    <div style="display: inline-block; padding: 2px 8px; background: #000; color: #fff; font-size: 11px; font-weight: bold; margin-top: 4px;">
      PICKUP
    </div>
  </div>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 2px 0;">2x</td>
      <td style="padding: 2px 4px;">Margherita Pizza</td>
      <td style="padding: 2px 0; text-align: right;">$25.98</td>
    </tr>
    <tr>
      <td style="padding: 2px 0;">1x</td>
      <td style="padding: 2px 4px;">Caesar Salad</td>
      <td style="padding: 2px 0; text-align: right;">$8.99</td>
    </tr>
    <tr>
      <td style="padding: 2px 0;">1x</td>
      <td style="padding: 2px 4px;">Garlic Bread</td>
      <td style="padding: 2px 0; text-align: right;">$4.99</td>
    </tr>
  </table>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <div style="display: flex; justify-content: space-between;"><span>Subtotal</span><span>$39.96</span></div>
  <div style="display: flex; justify-content: space-between;"><span>Tax</span><span>$3.60</span></div>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <div style="font-weight: bold; display: flex; justify-content: space-between;">
    <span>TOTAL</span><span>$43.56</span>
  </div>
  <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />
  <div style="text-align: center; font-size: 11px;">
    ${now}
  </div>
  <div style="text-align: center; margin-top: 8px; font-size: 11px;">
    ✓ Printer test successful!
  </div>
</body>
</html>`;
  }
}

/**
 * Basic HTML escaping for test receipt content.
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
