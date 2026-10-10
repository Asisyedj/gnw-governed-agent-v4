/**
 * GNW Agricultural Orchestration Module
 * Domain-agnostic physical orchestration for precision agriculture workflows
 * Target: Sabalpur, Pasrur Tehsil, Sialkot District
 */

import { ledger, ImmutableLedger } from '../core/ledger/ImmutableLedger';

/**
 * Crop rotation cycle interface
 */
export interface CropRotation {
  seasonId: string;
  cropType: CropType;
  plantingDate: Date;
  harvestDate: Date;
  fieldId: string;
  soilAnalytics: SoilAnalytics;
  yieldEstimate: number; // kg/hectare
}

/**
 * Supported crop types for Sabalpur region
 */
export enum CropType {
  WHEAT = 'wheat',
  RICE = 'rice',
  MAIZE = 'maize',
  COTTON = 'cotton',
  SUGARCANE = 'sugarcane',
  VEGETABLES = 'vegetables',
  PULSES = 'pulses',
}

/**
 * Soil analytics data structure
 */
export interface SoilAnalytics {
  ph: number; // pH level (0-14)
  nitrogen: number; // kg/hectare
  phosphorus: number; // kg/hectare
  potassium: number; // kg/hectare
  organicMatter: number; // percentage
  moisture: number; // percentage
  temperature: number; // Celsius
  electricalConductivity: number; // dS/m
  texture: SoilTexture;
}

export enum SoilTexture {
  SANDY = 'sandy',
  LOAMY = 'loamy',
  CLAY = 'clay',
  SILT = 'silt',
  LOAM = 'loam',
}

/**
 * Field management interface
 */
export interface Field {
  fieldId: string;
  location: GeoLocation;
  area: number; // hectares
  soilType: SoilTexture;
  irrigationType: IrrigationType;
  cropHistory: CropRotation[];
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  elevation: number; // meters
}

export enum IrrigationType {
  DRIP = 'drip',
  SPRINKLER = 'sprinkler',
  FLOOD = 'flood',
  RAINFED = 'rainfed',
}

/**
 * Agricultural orchestration engine
 */
export class AgriculturalOrchestrator {
  private ledger: ImmutableLedger;
  private fields: Map<string, Field> = new Map();
  private rotations: Map<string, CropRotation> = new Map();

  constructor(ledgerInstance?: ImmutableLedger) {
    this.ledger = ledgerInstance || ledger;
  }

  /**
   * Register a new field
   */
  async registerField(field: Field): Promise<void> {
    await this.ledger.append('FIELD_REGISTERED', {
      fieldId: field.fieldId,
      location: field.location,
      area: field.area,
      soilType: field.soilType,
    });

    this.fields.set(field.fieldId, field);
  }

  /**
   * Plan crop rotation for a field
   */
  async planRotation(rotation: CropRotation): Promise<void> {
    await this.ledger.append('ROTATION_PLANNED', {
      seasonId: rotation.seasonId,
      fieldId: rotation.fieldId,
      cropType: rotation.cropType,
      plantingDate: rotation.plantingDate.toISOString(),
      harvestDate: rotation.harvestDate.toISOString(),
    });

    this.rotations.set(rotation.seasonId, rotation);
  }

  /**
   * Record soil analytics
   */
  async recordSoilAnalytics(
    fieldId: string,
    analytics: SoilAnalytics
  ): Promise<void> {
    await this.ledger.append('SOIL_ANALYTICS_RECORDED', {
      fieldId,
      analytics,
    });

    const field = this.fields.get(fieldId);
    if (field) {
      const latestRotation = Array.from(this.rotations.values())
        .filter((r) => r.fieldId === fieldId)
        .sort(
          (a, b) =>
            b.plantingDate.getTime() - a.plantingDate.getTime()
        )[0];

      if (latestRotation) {
        latestRotation.soilAnalytics = analytics;
      }
    }
  }

  /**
   * Calculate optimal crop for field based on soil analytics
   */
  calculateOptimalCrop(analytics: SoilAnalytics): CropType {
    // Decision logic based on soil properties
    if (analytics.ph < 6.0) {
      return CropType.PULSES; // Acidic soil suits pulses
    }

    if (analytics.nitrogen > 200 && analytics.moisture > 60) {
      return CropType.RICE; // High nitrogen and moisture for rice
    }

    if (analytics.ph >= 6.0 && analytics.ph <= 7.5 && analytics.texture === SoilTexture.LOAM) {
      return CropType.WHEAT; // Ideal wheat conditions
    }

    if (analytics.temperature > 30 && analytics.moisture < 40) {
      return CropType.COTTON; // Hot and dry for cotton
    }

    if (analytics.nitrogen > 150 && analytics.ph >= 6.5) {
      return CropType.SUGARCANE; // High nitrogen for sugarcane
    }

    return CropType.VEGETABLES; // Default
  }

  /**
   * Generate crop rotation recommendation
   */
  generateRotationRecommendation(fieldId: string): CropRotation[] {
    const field = this.fields.get(fieldId);
    if (!field) {
      throw new Error(`Field ${fieldId} not found`);
    }

    const currentSeason = new Date();
    const recommendations: CropRotation[] = [];

    // 3-season rotation plan
    const rotationPlan = [
      { crop: CropType.WHEAT, months: 4 },
      { crop: CropType.PULSES, months: 3 },
      { crop: CropType.VEGETABLES, months: 3 },
    ];

    let seasonStart = currentSeason;

    for (const [index, plan] of rotationPlan.entries()) {
      const plantingDate = new Date(seasonStart);
      const harvestDate = new Date(seasonStart);
      harvestDate.setMonth(harvestDate.getMonth() + plan.months);

      const rotation: CropRotation = {
        seasonId: `${fieldId}_season_${index + 1}`,
        cropType: plan.crop,
        plantingDate,
        harvestDate,
        fieldId,
        soilAnalytics: field.cropHistory.length > 0
          ? field.cropHistory.at(-1)?.soilAnalytics ?? this.getDefaultSoilAnalytics(field.soilType)
          : this.getDefaultSoilAnalytics(field.soilType),
        yieldEstimate: this.estimateYield(plan.crop, field.soilType),
      };

      recommendations.push(rotation);
      seasonStart = harvestDate;
    }

    return recommendations;
  }

  /**
   * Estimate yield based on crop type and soil
   */
  private estimateYield(crop: CropType, soilType: SoilTexture): number {
    const baseYields: Record<CropType, number> = {
      [CropType.WHEAT]: 4500,
      [CropType.RICE]: 6000,
      [CropType.MAIZE]: 5500,
      [CropType.COTTON]: 2500,
      [CropType.SUGARCANE]: 70000,
      [CropType.VEGETABLES]: 15000,
      [CropType.PULSES]: 2000,
    };

    const soilFactors: Record<SoilTexture, number> = {
      [SoilTexture.SANDY]: 0.7,
      [SoilTexture.LOAMY]: 0.9,
      [SoilTexture.CLAY]: 0.8,
      [SoilTexture.SILT]: 0.85,
      [SoilTexture.LOAM]: 1.0,
    };

    return baseYields[crop] * soilFactors[soilType];
  }

  /**
   * Get default soil analytics for soil type
   */
  private getDefaultSoilAnalytics(soilType: SoilTexture): SoilAnalytics {
    const defaults: Record<SoilTexture, SoilAnalytics> = {
      [SoilTexture.SANDY]: {
        ph: 6.5,
        nitrogen: 80,
        phosphorus: 20,
        potassium: 150,
        organicMatter: 1.5,
        moisture: 25,
        temperature: 28,
        electricalConductivity: 1.2,
        texture: SoilTexture.SANDY,
      },
      [SoilTexture.LOAMY]: {
        ph: 6.8,
        nitrogen: 150,
        phosphorus: 35,
        potassium: 200,
        organicMatter: 3.0,
        moisture: 45,
        temperature: 26,
        electricalConductivity: 1.5,
        texture: SoilTexture.LOAMY,
      },
      [SoilTexture.CLAY]: {
        ph: 7.2,
        nitrogen: 120,
        phosphorus: 30,
        potassium: 180,
        organicMatter: 2.5,
        moisture: 55,
        temperature: 25,
        electricalConductivity: 1.8,
        texture: SoilTexture.CLAY,
      },
      [SoilTexture.SILT]: {
        ph: 6.9,
        nitrogen: 140,
        phosphorus: 32,
        potassium: 190,
        organicMatter: 2.8,
        moisture: 50,
        temperature: 26,
        electricalConductivity: 1.6,
        texture: SoilTexture.SILT,
      },
      [SoilTexture.LOAM]: {
        ph: 6.8,
        nitrogen: 160,
        phosphorus: 40,
        potassium: 220,
        organicMatter: 3.5,
        moisture: 50,
        temperature: 26,
        electricalConductivity: 1.5,
        texture: SoilTexture.LOAM,
      },
    };

    return defaults[soilType];
  }

  /**
   * Get field by ID
   */
  getField(fieldId: string): Field | undefined {
    return this.fields.get(fieldId);
  }

  /**
   * Get all rotations for a field
   */
  getFieldRotations(fieldId: string): CropRotation[] {
    return Array.from(this.rotations.values()).filter(
      (r) => r.fieldId === fieldId
    );
  }

  /**
   * Export orchestration state
   */
  exportState(): {
    fields: Field[];
    rotations: CropRotation[];
  } {
    return {
      fields: Array.from(this.fields.values()),
      rotations: Array.from(this.rotations.values()),
    };
  }
}

// Export singleton instance
export const agriculturalOrchestrator = new AgriculturalOrchestrator();

export default AgriculturalOrchestrator;
