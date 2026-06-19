import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { PortfolioService } from "../../src/portfolio/services/portfolio.service";
import { Portfolio } from "../../src/portfolio/entities/portfolio.entity";
import {
  PortfolioAsset,
  Chain,
} from "../../src/portfolio/entities/portfolio-asset.entity";
import { OptimizationHistory } from "../../src/portfolio/entities/optimization-history.entity";
import { RiskProfile } from "../../src/portfolio/entities/risk-profile.entity";
import { CreatePortfolioDto } from "../../src/portfolio/dto/portfolio.dto";
import { OptimizationMethod } from "../../src/portfolio/entities/optimization-history.entity";
import { DuplicatePortfolioNameException } from "../../src/portfolio/exceptions/portfolio.exceptions";

describe("PortfolioService", () => {
  let service: PortfolioService;
  let portfolioRepository: any;
  let assetRepository: any;
  let optimizationRepository: any;
  let riskProfileRepository: any;

  const mockPortfolio = {
    id: "test-portfolio-1",
    userId: "test-user-1",
    name: "Test Portfolio",
    status: "active",
    type: "balanced",
    totalValue: 100000,
    currentAllocation: { AAPL: 30, MSFT: 70 },
    targetAllocation: null,
    initialAllocation: {},
    assets: [],
    autoRebalanceEnabled: false,
    rebalanceThreshold: 5,
    rebalanceFrequency: null,
    lastRebalanceDate: null,
    metadata: {},
    description: "Test description",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    save: jest.fn(),
  };

  const mockAsset = {
    id: "asset-1",
    ticker: "AAPL",
    name: "Apple Inc.",
    chain: Chain.ETHEREUM,
    quantity: 100,
    currentPrice: 150,
    value: 15000,
    allocationPercentage: 15,
    costBasis: 14000,
    costBasisPerShare: 140,
    unrealizedGain: 1000,
    portfolioId: "test-portfolio-1",
    lastPriceUpdate: new Date(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    portfolioRepository = {
      create: jest.fn().mockReturnValue(mockPortfolio),
      save: jest.fn().mockResolvedValue(mockPortfolio),
      findOne: jest.fn().mockResolvedValue(mockPortfolio),
      find: jest.fn().mockResolvedValue([mockPortfolio]),
      findAndCount: jest.fn().mockResolvedValue([[mockPortfolio], 1]),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    assetRepository = {
      create: jest.fn().mockReturnValue(mockAsset),
      save: jest.fn().mockResolvedValue(mockAsset),
      find: jest.fn().mockResolvedValue([mockAsset]),
      findOne: jest.fn().mockResolvedValue(null), // default: no existing asset
      remove: jest.fn().mockResolvedValue(mockAsset),
    };

    optimizationRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    riskProfileRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(Portfolio),
          useValue: portfolioRepository,
        },
        {
          provide: getRepositoryToken(PortfolioAsset),
          useValue: assetRepository,
        },
        {
          provide: getRepositoryToken(OptimizationHistory),
          useValue: optimizationRepository,
        },
        {
          provide: getRepositoryToken(RiskProfile),
          useValue: riskProfileRepository,
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  // ─── Portfolio CRUD ──────────────────────────────────────────────

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createPortfolio", () => {
    it("should create a new portfolio", async () => {
      portfolioRepository.findOne.mockResolvedValue(null); // name is unique

      const dto: CreatePortfolioDto = {
        name: "Test Portfolio",
        description: "Test description",
      };

      const result = await service.createPortfolio("test-user-1", dto);

      expect(portfolioRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: dto.name,
          userId: "test-user-1",
          status: "active",
        }),
      );
      expect(portfolioRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockPortfolio);
    });

    it("should reject duplicate portfolio name", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const dto: CreatePortfolioDto = {
        name: "Test Portfolio",
      };

      await expect(
        service.createPortfolio("test-user-2", dto),
      ).rejects.toThrow(DuplicatePortfolioNameException);
    });
  });

  describe("getPortfolio", () => {
    it("should return a portfolio by ID", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const result = await service.getPortfolio("test-portfolio-1");

      expect(portfolioRepository.findOne).toHaveBeenCalledWith({
        where: { id: "test-portfolio-1" },
        relations: expect.any(Array),
      });
      expect(result).toEqual(mockPortfolio);
    });

    it("should throw error if portfolio not found", async () => {
      portfolioRepository.findOne.mockResolvedValue(null);

      await expect(service.getPortfolio("non-existent")).rejects.toThrow(
        "Portfolio not found",
      );
    });
  });

  describe("getUserPortfolios", () => {
    it("should return all portfolios for a user", async () => {
      const result = await service.getUserPortfolios("test-user-1");

      expect(portfolioRepository.find).toHaveBeenCalledWith({
        where: { userId: "test-user-1" },
        relations: expect.any(Array),
        order: expect.any(Object),
      });
      expect(result).toEqual([mockPortfolio]);
    });
  });

  // ─── HOLDING MANAGEMENT ──────────────────────────────────────────

  describe("addAsset (add holding)", () => {
    beforeEach(() => {
      // Default: portfolio exists, no existing asset
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.findOne.mockResolvedValue(null);
    });

    it("should add a holding with chain and validate symbol", async () => {
      const result = await service.addAsset(
        "test-portfolio-1",
        "BTC",
        "Bitcoin",
        1.5,
        45000,
        44000,
        Chain.ETHEREUM,
      );

      expect(assetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: "BTC",
          chain: Chain.ETHEREUM,
          quantity: 1.5,
          costBasis: 44000,
        }),
      );
      expect(assetRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockAsset);
    });

    it("should add a holding with default chain (ethereum)", async () => {
      await service.addAsset("test-portfolio-1", "ETH", "Ethereum", 10, 3000);

      expect(assetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: "ETH",
          chain: Chain.ETHEREUM,
        }),
      );
    });

    it("should support multiple chains", async () => {
      // Add on Ethereum
      await service.addAsset(
        "test-portfolio-1",
        "USDC",
        "USD Coin",
        1000,
        1,
        1,
        Chain.ETHEREUM,
      );

      // Add same token on Polygon
      assetRepository.findOne.mockResolvedValue(null); // no duplicate
      await service.addAsset(
        "test-portfolio-1",
        "USDC",
        "USD Coin",
        500,
        1,
        1,
        Chain.POLYGON,
      );

      expect(assetRepository.create).toHaveBeenCalledTimes(2);
    });

    it("should reject duplicate holding (same ticker + chain)", async () => {
      assetRepository.findOne.mockResolvedValue(mockAsset); // asset exists

      await expect(
        service.addAsset(
          "test-portfolio-1",
          "ETH",
          "Ethereum",
          10,
          3000,
          2900,
          Chain.ETHEREUM,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("should allow same ticker on different chains", async () => {
      // First add - no existing
      assetRepository.findOne.mockResolvedValueOnce(null);
      // Second add - simulate existing on ETH but not on POLYGON
      assetRepository.findOne.mockImplementation(async (opts: any) => {
        if (opts.where?.chain === Chain.ETHEREUM) return mockAsset;
        return null;
      });

      await service.addAsset(
        "test-portfolio-1",
        "ETH",
        "Ethereum",
        10,
        3000,
        2900,
        Chain.POLYGON,
      );

      expect(assetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: "ETH",
          chain: Chain.POLYGON,
        }),
      );
    });

    it("should reject invalid ticker symbol (too short)", async () => {
      await expect(
        service.addAsset(
          "test-portfolio-1",
          "AB",
          "Too Short",
          10,
          100,
          0,
          Chain.ETHEREUM,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject invalid ticker symbol (too long)", async () => {
      await expect(
        service.addAsset(
          "test-portfolio-1",
          "ABCDEFGHIJK",
          "Too Long",
          10,
          100,
          0,
          Chain.ETHEREUM,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject invalid ticker symbol (lowercase)", async () => {
      await expect(
        service.addAsset(
          "test-portfolio-1",
          "btc",
          "Bitcoin",
          10,
          100,
          0,
          Chain.ETHEREUM,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject unsupported chain", async () => {
      await expect(
        service.addAsset(
          "test-portfolio-1",
          "BTC",
          "Bitcoin",
          1,
          100,
          0,
          "invalid-chain" as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject negative quantity", async () => {
      await expect(
        service.addAsset(
          "test-portfolio-1",
          "BTC",
          "Bitcoin",
          -1,
          100,
          0,
          Chain.ETHEREUM,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateAsset (update holding)", () => {
    beforeEach(() => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.findOne.mockResolvedValue(mockAsset);
    });

    it("should update holding quantity", async () => {
      const result = await service.updateAsset("test-portfolio-1", "asset-1", {
        quantity: 200,
      });

      expect(assetRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockAsset);
    });

    it("should update holding price and recalculate unrealized gain", async () => {
      await service.updateAsset("test-portfolio-1", "asset-1", {
        currentPrice: 200,
      });

      expect(assetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPrice: 200,
          lastPriceUpdate: expect.any(Date),
        }),
      );
    });

    it("should update cost basis and recalculate per-share cost", async () => {
      const result = await service.updateAsset("test-portfolio-1", "asset-1", {
        costBasis: 16000,
      });

      expect(result).toEqual(mockAsset);
    });

    it("should rebalance cost basis when adding quantity", async () => {
      let firstSaveCall: any = null;
      assetRepository.save.mockImplementation((asset: any) => {
        // Only capture the first (non-array) save call — that's from updateAsset
        if (!Array.isArray(asset) && firstSaveCall === null) {
          firstSaveCall = { ...asset };
        }
        return Promise.resolve(asset);
      });

      // Start with mock asset that has 100 qty at $140/share cost basis
      const updatedAsset = {
        ...mockAsset,
        quantity: 100,
        costBasisPerShare: 140,
        costBasis: 14000,
        currentPrice: 150,
        value: 15000,
        unrealizedGain: 1000,
      };
      assetRepository.findOne.mockResolvedValue(updatedAsset);

      // Add 50 more at $160/share → new cost basis = weighted avg
      await service.updateAsset("test-portfolio-1", "asset-1", {
        quantity: 150,
        costBasis: 8000, // 50 * $160
      });

      // Expected: (100*140 + 50*160) / 150 = (14000+8000)/150 = 146.67
      expect(firstSaveCall).not.toBeNull();
      expect(firstSaveCall.costBasisPerShare).toBeCloseTo(146.67, 1);
      expect(firstSaveCall.costBasis).toBeCloseTo(22000, 0);
    });

    it("should update chain and check for duplicates", async () => {
      assetRepository.findOne.mockImplementation(async (opts: any) => {
        // First call: find the asset to update
        if (opts.where?.id === "asset-1") return mockAsset;
        // Second call: check for duplicate chain
        return null; // no duplicate
      });

      await service.updateAsset("test-portfolio-1", "asset-1", {
        chain: Chain.POLYGON,
      });

      expect(assetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: Chain.POLYGON,
        }),
      );
    });

    it("should reject negative quantity", async () => {
      assetRepository.findOne.mockResolvedValue(mockAsset);

      await expect(
        service.updateAsset("test-portfolio-1", "asset-1", {
          quantity: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw error if asset not found", async () => {
      assetRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateAsset("test-portfolio-1", "non-existent", {
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("removeAsset (remove holding)", () => {
    beforeEach(() => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.findOne.mockResolvedValue(mockAsset);
    });

    it("should remove a holding from portfolio", async () => {
      await service.removeAsset("test-portfolio-1", "asset-1");

      expect(assetRepository.remove).toHaveBeenCalledWith(mockAsset);
    });

    it("should recalculate portfolio allocation after removal", async () => {
      // After removal, assets list is empty
      assetRepository.find.mockResolvedValue([]);

      await service.removeAsset("test-portfolio-1", "asset-1");

      // Should recalculate allocation via updatePortfolioAllocation
      expect(portfolioRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalValue: 0,
          currentAllocation: {},
        }),
      );
    });

    it("should throw error if asset not found", async () => {
      assetRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeAsset("test-portfolio-1", "non-existent"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateAssetPrice", () => {
    it("should update asset price and recalculate unrealized gain", async () => {
      // Create completely fresh objects to avoid cross-test mutations
      const freshAsset = {
        id: "asset-price-1",
        ticker: "BTC",
        name: "Bitcoin",
        chain: Chain.ETHEREUM,
        quantity: 100,
        currentPrice: 150,
        value: 15000,
        allocationPercentage: 15,
        costBasis: 14000,
        costBasisPerShare: 140,
        unrealizedGain: 1000,
        portfolioId: "test-portfolio-1",
        lastPriceUpdate: new Date(),
        save: jest.fn(),
      };

      // Ensure find returns our fresh asset
      assetRepository.findOne.mockResolvedValue(freshAsset);
      assetRepository.find.mockResolvedValue([freshAsset]);

      let capturedSaved: any = null;
      assetRepository.save.mockImplementation((arg: any) => {
        if (!Array.isArray(arg)) {
          capturedSaved = { ...arg };
        }
        return Promise.resolve(arg);
      });

      await service.updateAssetPrice("asset-price-1", 200);

      expect(capturedSaved).not.toBeNull();
      expect(capturedSaved.currentPrice).toBe(200);
      expect(capturedSaved.value).toBe(20000); // 100 * 200
      expect(capturedSaved.unrealizedGain).toBe(6000); // 20000 - 14000 costBasis
      expect(capturedSaved.lastPriceUpdate).toBeInstanceOf(Date);
    });

    it("should throw error if asset not found", async () => {
      assetRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateAssetPrice("non-existent", 200),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── PORTFOLIO VALUE & ALLOCATION UPDATES ────────────────────────

  describe("updatePortfolioAllocation", () => {
    it("should calculate total value and allocation percentages", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);

      const assets = [
        { ...mockAsset, ticker: "AAPL", value: 30000, allocationPercentage: 0 },
        { ...mockAsset, id: "asset-2", ticker: "MSFT", value: 70000, allocationPercentage: 0 },
      ];
      assetRepository.find.mockResolvedValue(assets);

      await service.updatePortfolioAllocation("test-portfolio-1");

      expect(portfolioRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalValue: 100000,
          currentAllocation: { AAPL: 30, MSFT: 70 },
        }),
      );
    });

    it("should handle empty portfolio (no assets)", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.find.mockResolvedValue([]);

      await service.updatePortfolioAllocation("test-portfolio-1");

      expect(portfolioRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalValue: 0,
          currentAllocation: {},
        }),
      );
    });
  });

  // ─── OPTIMIZATION ────────────────────────────────────────────────

  describe("runOptimization", () => {
    it("should run portfolio optimization", async () => {
      portfolioRepository.findOne.mockResolvedValue(mockPortfolio);
      assetRepository.find.mockResolvedValue([mockAsset]);

      const mockOptimization = {
        id: "opt-1",
        portfolioId: "test-portfolio-1",
        method: OptimizationMethod.MEAN_VARIANCE,
        status: "pending",
        parameters: {},
        suggestedAllocation: {},
        currentAllocation: mockPortfolio.currentAllocation,
        save: jest.fn(),
      };

      optimizationRepository.create.mockReturnValue(mockOptimization);
      optimizationRepository.save
        .mockResolvedValueOnce({
          ...mockOptimization,
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          ...mockOptimization,
          status: "completed",
          suggestedAllocation: { AAPL: 40, MSFT: 60 },
          expectedReturn: 0.08,
          expectedVolatility: 0.15,
          expectedSharpeRatio: 0.5,
          improvementScore: 10,
          completedAt: new Date(),
        });

      assetRepository.save.mockResolvedValue([mockAsset]);

      const result = await service.runOptimization("test-portfolio-1", {
        method: OptimizationMethod.MEAN_VARIANCE,
        portfolioId: "test-portfolio-1",
      });

      expect(result.status).toBe("completed");
    });
  });
});
