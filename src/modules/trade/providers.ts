import { runtimeConfig } from "@/lib/env";
import type { TradeCompanyMatch, TradeIntelligenceProvider } from "@/types/providers";

export class MockTradeProvider implements TradeIntelligenceProvider {
  async searchCompany(companyName: string): Promise<TradeCompanyMatch> {
    void companyName;
    return {
      status: "Not Connected",
      summary: "Trade-history verification is pending. No trade data is fabricated.",
    };
  }

  async getImports(): Promise<unknown[]> {
    return [];
  }

  async getSuppliers(): Promise<unknown[]> {
    return [];
  }

  async getProducts(): Promise<unknown[]> {
    return [];
  }

  async getRecentShipments(): Promise<unknown[]> {
    return [];
  }
}

export class VolzaTradeProvider extends MockTradeProvider {
  constructor(private readonly apiKey: string) {
    super();
  }

  override async searchCompany(companyName: string): Promise<TradeCompanyMatch> {
    void this.apiKey;
    return {
      status: "Pending",
      summary: `${companyName} is ready for trade-history lookup once the API contract is supplied.`,
    };
  }
}

export function createTradeProvider(): TradeIntelligenceProvider {
  if (runtimeConfig.tradeDataKey) {
    return new VolzaTradeProvider(runtimeConfig.tradeDataKey);
  }

  return new MockTradeProvider();
}
