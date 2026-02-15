/**
 * @fileoverview Communication provider interfaces.
 * Mirrors OrderChop's IEmailProvider pattern and adds SMS counterpart.
 * Provider factories return implementations of these interfaces.
 *
 * @module domain/interfaces/ICommunicationProvider
 */

/**
 * Options for sending an email.
 * Mirrors OrderChop's existing EmailOptions interface.
 */
export interface IEmailOptions {
  /** Recipient email address(es) */
  to: string | string[];
  /** Email subject line */
  subject: string;
  /** HTML email body */
  html: string;
  /** Plain text fallback body */
  text?: string;
  /** Sender address override (defaults to configured FROM address) */
  from?: string;
  /** CC recipients */
  cc?: string[];
  /** BCC recipients */
  bcc?: string[];
  /** Reply-to address */
  replyTo?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned after sending an email.
 */
export interface IEmailSendResult {
  /** Provider-assigned message ID */
  messageId: string;
  /** Delivery status from the provider */
  status: string;
  /** Timestamp of the send */
  timestamp: Date;
}

/**
 * Email provider interface.
 * Mirrors OrderChop's IEmailProvider from `lib/email/interfaces/IEmailProvider.ts`.
 */
export interface IEmailProvider {
  /**
   * Initialize the provider with configuration.
   * Called once during factory creation.
   *
   * @param config - Provider-specific configuration
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Send a single email.
   *
   * @param options - Email send options
   * @returns Send result with messageId and status
   */
  sendEmail(options: IEmailOptions): Promise<IEmailSendResult>;

  /**
   * Send multiple emails in bulk.
   *
   * @param options - Array of email send options
   * @returns Array of send results
   */
  sendBulkEmail(options: IEmailOptions[]): Promise<IEmailSendResult[]>;

  /**
   * Get the provider name (e.g., "mailgun", "sendgrid").
   *
   * @returns Provider identifier string
   */
  getProviderName(): string;
}

// ────────────────────────────────────────────────────────────
// SMS Provider
// ────────────────────────────────────────────────────────────

/**
 * Options for sending an SMS message.
 */
export interface ISMSOptions {
  /** Recipient phone number in E.164 format (e.g., "+15551234567") */
  to: string;
  /** SMS message body (plain text, max 1600 chars for multi-segment) */
  body: string;
  /** Sender phone number override */
  from?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned after sending an SMS.
 */
export interface ISMSSendResult {
  /** Provider-assigned message ID */
  messageId: string;
  /** Delivery status from the provider */
  status: string;
  /** Timestamp of the send */
  timestamp: Date;
  /** Number of SMS segments used */
  segments?: number;
}

/**
 * SMS provider interface.
 */
export interface ISMSProvider {
  /**
   * Initialize the provider with configuration.
   *
   * @param config - Provider-specific configuration
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Send a single SMS.
   *
   * @param options - SMS send options
   * @returns Send result with messageId and status
   */
  sendSMS(options: ISMSOptions): Promise<ISMSSendResult>;

  /**
   * Get the provider name (e.g., "twilio", "messagebird").
   *
   * @returns Provider identifier string
   */
  getProviderName(): string;
}
