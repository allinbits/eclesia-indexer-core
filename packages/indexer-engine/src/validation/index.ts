/**
 * Configuration validation utilities for the Eclesia indexer
 * Validates configuration parameters before initialization
 */

import * as fs from "node:fs";

import {
  ConfigurationError,
} from "../errors/index.js";

/**
 * Validates a URL string
 * @param url - The URL to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ConfigurationError} If URL is invalid
 */
export function validateUrl(url: string, fieldName: string = "URL"): void {
  if (!url || typeof url !== "string") {
    throw new ConfigurationError(`${fieldName} is required and must be a string`, {
      fieldName,
      value: url,
    });
  }

  try {
    const parsed = new URL(url);

    // Ensure protocol is http or https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new ConfigurationError(`${fieldName} must use http, https, ws, or wss protocol`, {
        fieldName,
        url,
        protocol: parsed.protocol,
      });
    }

    // Ensure hostname is present
    if (!parsed.hostname) {
      throw new ConfigurationError(`${fieldName} must include a hostname`, {
        fieldName,
        url,
      });
    }
  }
  catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(`${fieldName} is not a valid URL: ${error}`, {
      fieldName,
      url,
    });
  }
}

/**
 * Validates a file path exists and is readable
 * @param filePath - The file path to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ConfigurationError} If file doesn't exist or isn't readable
 */
export function validateFilePath(filePath: string, fieldName: string = "File path"): void {
  if (!filePath || typeof filePath !== "string") {
    throw new ConfigurationError(`${fieldName} is required and must be a string`, {
      fieldName,
      value: filePath,
    });
  }

  if (!fs.existsSync(filePath)) {
    throw new ConfigurationError(`${fieldName} does not exist: ${filePath}`, {
      fieldName,
      filePath,
    });
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  }
  catch (error) {
    throw new ConfigurationError(`${fieldName} is not readable: ${filePath}`, {
      fieldName,
      filePath,
      error: String(error),
    });
  }
}

/**
 * Validates a PostgreSQL connection string
 * @param connectionString - The connection string to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ConfigurationError} If connection string is invalid
 */
export function validatePostgresConnectionString(
  connectionString: string,
  fieldName: string = "Database connection string",
): void {
  if (!connectionString || typeof connectionString !== "string") {
    throw new ConfigurationError(`${fieldName} is required and must be a string`, {
      fieldName,
      value: connectionString,
    });
  }

  // Basic PostgreSQL connection string format validation
  // Format: postgres://user:password@host:port/database
  const pgRegex = /^postgres(?:ql)?:\/\/(?:([^:]+)(?::([^@]+))?@)?([^:/]+)(?::(\d+))?\/(.+)$/;

  if (!pgRegex.test(connectionString)) {
    throw new ConfigurationError(
      `${fieldName} must be in format: postgres://user:password@host:port/database`,
      {
        fieldName,
        format: "postgres://user:password@host:port/database",
      },
    );
  }
}

/**
 * Validates a port number
 * @param port - The port number to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ConfigurationError} If port is invalid
 */
export function validatePort(port: number, fieldName: string = "Port"): void {
  if (typeof port !== "number" || !Number.isInteger(port)) {
    throw new ConfigurationError(`${fieldName} must be an integer`, {
      fieldName,
      value: port,
    });
  }

  if (port < 1 || port > 65535) {
    throw new ConfigurationError(`${fieldName} must be between 1 and 65535`, {
      fieldName,
      value: port,
      min: 1,
      max: 65535,
    });
  }
}

/**
 * Validates a positive integer
 * @param value - The value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {ConfigurationError} If value is not a positive integer
 */
export function validatePositiveInteger(value: number, fieldName: string = "Value"): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(`${fieldName} must be a positive integer`, {
      fieldName,
      value,
    });
  }
}
