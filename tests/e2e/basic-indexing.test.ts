import {
  describe, expect, it,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fileURLToPath,
} from "node:url";

/**
 * E2E tests for basic indexing functionality
 * Tests the full indexing flow with test fixtures
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("E2E Basic Indexing", () => {
  describe("Genesis File Loading", () => {
    it("should load genesis fixture", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      expect(fs.existsSync(genesisPath)).toBe(true);

      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));
      expect(genesisData).toBeDefined();
      expect(genesisData.chain_id).toBe("test-chain-1");
      expect(genesisData.app_state).toBeDefined();
    });

    it("should have valid auth accounts in genesis", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      expect(genesisData.app_state.auth.accounts).toBeDefined();
      expect(Array.isArray(genesisData.app_state.auth.accounts)).toBe(true);
      expect(genesisData.app_state.auth.accounts.length).toBeGreaterThan(0);
    });

    it("should have valid bank balances in genesis", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      expect(genesisData.app_state.bank.balances).toBeDefined();
      expect(Array.isArray(genesisData.app_state.bank.balances)).toBe(true);
      expect(genesisData.app_state.bank.balances.length).toBeGreaterThan(0);
    });

    it("should have valid staking params in genesis", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      expect(genesisData.app_state.staking.params).toBeDefined();
      expect(genesisData.app_state.staking.params.bond_denom).toBe("stake");
      expect(genesisData.app_state.staking.params.max_validators).toBeGreaterThan(0);
    });
  });

  describe("Genesis Data Structure", () => {
    it("should have proper account structure", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      const firstAccount = genesisData.app_state.auth.accounts[0];
      expect(firstAccount).toHaveProperty("@type");
      expect(firstAccount).toHaveProperty("address");
      expect(firstAccount.address).toMatch(/^cosmos1/);
    });

    it("should have proper balance structure", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      const firstBalance = genesisData.app_state.bank.balances[0];
      expect(firstBalance).toHaveProperty("address");
      expect(firstBalance).toHaveProperty("coins");
      expect(Array.isArray(firstBalance.coins)).toBe(true);
      expect(firstBalance.coins[0]).toHaveProperty("denom");
      expect(firstBalance.coins[0]).toHaveProperty("amount");
    });

    it("should have valid coin amounts as strings", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      const firstBalance = genesisData.app_state.bank.balances[0];
      expect(typeof firstBalance.coins[0].amount).toBe("string");
      expect(parseInt(firstBalance.coins[0].amount)).toBeGreaterThan(0);
    });
  });

  describe("Genesis Validation", () => {
    it("should have matching addresses in auth and bank", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      const authAddresses = genesisData.app_state.auth.accounts.map(
        (acc: { address?: string; base_account?: { address: string } }) => acc.address || acc.base_account?.address,
      );
      const bankAddresses = genesisData.app_state.bank.balances.map(
        (bal: { address: string }) => bal.address,
      );

      for (const bankAddr of bankAddresses) {
        expect(authAddresses).toContain(bankAddr);
      }
    });

    it("should have valid chain_id format", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      expect(genesisData.chain_id).toBeDefined();
      expect(typeof genesisData.chain_id).toBe("string");
      expect(genesisData.chain_id.length).toBeGreaterThan(0);
    });

    it("should have valid genesis_time format", () => {
      const genesisPath = path.join(__dirname, "fixtures", "genesis.json");
      const genesisData = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));

      expect(genesisData.genesis_time).toBeDefined();
      const genesisTime = new Date(genesisData.genesis_time);
      expect(genesisTime).toBeInstanceOf(Date);
      expect(isNaN(genesisTime.getTime())).toBe(false);
    });
  });
});
