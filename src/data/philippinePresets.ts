import { TransmissionType, EngineCooling, MaintenanceReminder, ServiceCategory } from '../types';

export interface PhilippineModelPreset {
  brand: string;
  model: string;
  year: number;
  transmission: TransmissionType;
  cooling: EngineCooling;
  displacementCc: number;
  oilViscosity: string;
  oilCapacityLiters: number;
  gearOilCapacityMl?: number;
  tirePressureFrontPsi: number;
  tirePressureRearPsi: number;
  chainSlackMm?: string;
  recommendedServiceIntervalKm: number;
  description: string;
}

export const PHILIPPINE_MOTORCYCLE_PRESETS: PhilippineModelPreset[] = [
  // --- Yamaha (Top Philippine Models) ---
  {
    brand: 'Yamaha',
    model: 'NMAX 155 V2 Connected',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    oilViscosity: '10W-40 JASO MB (Yamalube Blue Core AT)',
    oilCapacityLiters: 0.9,
    gearOilCapacityMl: 150,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'Maxi-scooter staple in Metro Manila and provincial touring with VVA engine.',
  },
  {
    brand: 'Yamaha',
    model: 'Aerox 155 V2',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    oilViscosity: '10W-40 JASO MB (Yamalube Power Matic)',
    oilCapacityLiters: 0.9,
    gearOilCapacityMl: 150,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'Sporty automatic scooter with wide 140/70 rear tire and aggressive riding stance.',
  },
  {
    brand: 'Yamaha',
    model: 'Mio Gravis 125',
    year: 2023,
    transmission: 'Automatic Scooter',
    cooling: 'Air-Cooled',
    displacementCc: 125,
    oilViscosity: '10W-40 JASO MB (Yamalube Blue Core)',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 100,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 2500,
    description: 'Chunky tire city commuter with front fuel tank cap for quick refueling.',
  },
  {
    brand: 'Yamaha',
    model: 'Mio Soul i125',
    year: 2023,
    transmission: 'Automatic Scooter',
    cooling: 'Air-Cooled',
    displacementCc: 125,
    oilViscosity: '10W-40 JASO MB (Yamalube Blue Core)',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 100,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 2500,
    description: 'Compact daily workhorse and delivery favorite across the Philippines.',
  },
  {
    brand: 'Yamaha',
    model: 'Sniper 155 R',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    oilViscosity: '10W-40 JASO MA2 (Yamalube 4T Full Syn)',
    oilCapacityLiters: 1.0,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'King of Philippine underbones with 6-speed assist & slipper clutch and VVA.',
  },
  {
    brand: 'Yamaha',
    model: 'MT-15',
    year: 2023,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    oilViscosity: '10W-40 JASO MA2',
    oilCapacityLiters: 1.05,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '30 - 40 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'Hyper-naked sport bike with inverted front forks and delta box frame.',
  },
  {
    brand: 'Yamaha',
    model: 'XSR 155',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    oilViscosity: '10W-40 JASO MA2',
    oilCapacityLiters: 1.05,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '30 - 40 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'Faster Sons retro-classic street scrambler.',
  },

  // --- Honda (Philippine Best-Sellers) ---
  {
    brand: 'Honda',
    model: 'Click 125i',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 125,
    oilViscosity: '10W-30 JASO MB (Honda 4T SL Scooter)',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 120,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'The undisputed commuter king of the Philippines with eSP engine and digital cluster.',
  },
  {
    brand: 'Honda',
    model: 'Click 160',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 157,
    oilViscosity: '10W-30 JASO MB (Honda Fully Synthetic)',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 120,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'High-torque 4-valve eSP+ engine with CBS or ABS and aggressive sharp bodywork.',
  },
  {
    brand: 'Honda',
    model: 'ADV 160',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 157,
    oilViscosity: '10W-30 JASO MB (Honda 4T Pro)',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 120,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'Adventure scooter with long-travel Showa sub-tank suspension, HSTC, and all-terrain tires.',
  },
  {
    brand: 'Honda',
    model: 'PCX 160 ABS',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 157,
    oilViscosity: '10W-30 JASO MB',
    oilCapacityLiters: 0.8,
    gearOilCapacityMl: 120,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 3500,
    description: 'Luxury executive scooter with plush riding comfort and 30L underseat storage.',
  },
  {
    brand: 'Honda',
    model: 'Beat 110 Fi',
    year: 2023,
    transmission: 'Automatic Scooter',
    cooling: 'Air-Cooled',
    displacementCc: 110,
    oilViscosity: '10W-30 JASO MB',
    oilCapacityLiters: 0.7,
    gearOilCapacityMl: 120,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 2500,
    description: 'Lightweight ultra fuel-efficient scooter (up to 58 km/L) ideal for student and daily riders.',
  },
  {
    brand: 'Honda',
    model: 'Wave RSX 110',
    year: 2023,
    transmission: 'Semi-Auto Underbone',
    cooling: 'Air-Cooled',
    displacementCc: 110,
    oilViscosity: '10W-30 JASO MA (Honda 4T MA)',
    oilCapacityLiters: 0.8,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '20 - 30 mm',
    recommendedServiceIntervalKm: 2500,
    description: 'Indestructible semi-automatic underbone known for unmatched reliability and low maintenance cost.',
  },
  {
    brand: 'Honda',
    model: 'Winner X 150',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 150,
    oilViscosity: '10W-30 / 10W-40 JASO MA2',
    oilCapacityLiters: 1.1,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'DOHC 6-speed manual underbone with slipper clutch and front ABS.',
  },
  {
    brand: 'Honda',
    model: 'CRF 300L',
    year: 2023,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 286,
    oilViscosity: '10W-30 JASO MA2',
    oilCapacityLiters: 1.5,
    tirePressureFrontPsi: 22,
    tirePressureRearPsi: 22,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 4000,
    description: 'Dual-sport trail conqueror for Sierra Madre, Benguet, and rough Philippine backroads.',
  },

  // --- Suzuki (Philippine Staples) ---
  {
    brand: 'Suzuki',
    model: 'Burgman Street 125 EX',
    year: 2024,
    transmission: 'Automatic Scooter',
    cooling: 'Air-Cooled',
    displacementCc: 124,
    oilViscosity: '10W-40 JASO MB (Suzuki Eco Performance)',
    oilCapacityLiters: 0.65,
    gearOilCapacityMl: 90,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    recommendedServiceIntervalKm: 2500,
    description: 'Maxi-styled executive comfort with silent starter and 12-inch rear wheel upgrade.',
  },
  {
    brand: 'Suzuki',
    model: 'Raider R150 Fi',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 147,
    oilViscosity: '10W-40 JASO MA2',
    oilCapacityLiters: 1.3,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'The legendary "Underbone King" of Philippine quarter-mile and club racing.',
  },
  {
    brand: 'Suzuki',
    model: 'Smash 115 Fi',
    year: 2023,
    transmission: 'Semi-Auto Underbone',
    cooling: 'Air-Cooled',
    displacementCc: 113,
    oilViscosity: '10W-40 JASO MA',
    oilCapacityLiters: 0.8,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '20 - 30 mm',
    recommendedServiceIntervalKm: 2500,
    description: 'Proven Philippine tricycle and provincial workhorse with legendary durability.',
  },
  {
    brand: 'Suzuki',
    model: 'Gixxer 250',
    year: 2023,
    transmission: 'Manual',
    cooling: 'Oil-Cooled',
    displacementCc: 249,
    oilViscosity: '10W-40 JASO MA2',
    oilCapacityLiters: 1.2,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 4000,
    description: 'SOCS (Suzuki Oil Cooling System) quarter-liter muscular naked machine.',
  },

  // --- Kawasaki / Bajaj ---
  {
    brand: 'Kawasaki',
    model: 'Barako II 175',
    year: 2023,
    transmission: 'Manual',
    cooling: 'Air-Cooled',
    displacementCc: 177,
    oilViscosity: '20W-50 / 10W-40 Heavy Duty 4T',
    oilCapacityLiters: 1.0,
    tirePressureFrontPsi: 28,
    tirePressureRearPsi: 32,
    chainSlackMm: '20 - 30 mm',
    recommendedServiceIntervalKm: 2500,
    description: 'The undisputed heavy-hauler tricycle backbone of Philippine transport.',
  },
  {
    brand: 'Bajaj / Kawasaki',
    model: 'Dominar 400 UG',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 373,
    oilViscosity: '10W-50 Full Synthetic JASO MA2',
    oilCapacityLiters: 1.7,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 5000,
    description: 'Expressway-legal 400cc sport tourer with USD forks and twin-barrel exhaust.',
  },
  {
    brand: 'Bajaj / Kawasaki',
    model: 'Rouser NS200 Fi',
    year: 2023,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 199,
    oilViscosity: '20W-50 / 10W-50 JASO MA2',
    oilCapacityLiters: 1.2,
    tirePressureFrontPsi: 28,
    tirePressureRearPsi: 32,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 3500,
    description: 'Triple-spark DTS-i liquid cooled streetfighter.',
  },
  {
    brand: 'Kawasaki',
    model: 'Ninja 400 ABS',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 399,
    oilViscosity: '10W-40 Full Synthetic',
    oilCapacityLiters: 2.0,
    tirePressureFrontPsi: 28,
    tirePressureRearPsi: 32,
    chainSlackMm: '20 - 30 mm',
    recommendedServiceIntervalKm: 5000,
    description: 'Twin-cylinder expressway legal sport bike popular on Marilaque highway.',
  },

  // --- KTM & CFMoto ---
  {
    brand: 'KTM',
    model: '390 Duke',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 399,
    oilViscosity: 'Motorex 15W-50 4T Full Synthetic',
    oilCapacityLiters: 1.6,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 32,
    chainSlackMm: '5 - 7 mm (swingarm guide)',
    recommendedServiceIntervalKm: 5000,
    description: 'Philippine-assembled Ayala-KTM Laguna powerhouse corner rocket.',
  },
  {
    brand: 'CFMoto',
    model: '450SR',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 449,
    oilViscosity: '10W-40 JASO MA2 Full Synthetic',
    oilCapacityLiters: 2.4,
    tirePressureFrontPsi: 33,
    tirePressureRearPsi: 36,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 4000,
    description: '270-degree crossplane-sound parallel-twin sportbike with aerodynamic winglets.',
  },
  {
    brand: 'CFMoto',
    model: '450NK',
    year: 2024,
    transmission: 'Manual',
    cooling: 'Liquid-Cooled',
    displacementCc: 449,
    oilViscosity: '10W-40 JASO MA2 Full Synthetic',
    oilCapacityLiters: 2.4,
    tirePressureFrontPsi: 33,
    tirePressureRearPsi: 36,
    chainSlackMm: '25 - 35 mm',
    recommendedServiceIntervalKm: 4000,
    description: 'Aggressive streetfighter naked with TFT connectivity and ABS/TCS.',
  },
];

/**
 * Generate Philippine OEM Maintenance Schedule from motorcycle specifications
 */
export function generateOemSchedule(
  bikeId: string,
  modelPreset: PhilippineModelPreset,
  currentOdo: number = 0
): MaintenanceReminder[] {
  const isScooter = modelPreset.transmission === 'Automatic Scooter';
  const isLiquidCooled = modelPreset.cooling === 'Liquid-Cooled';
  const isChainDrive = modelPreset.transmission === 'Manual' || modelPreset.transmission === 'Semi-Auto Underbone';

  // Engine Oil Interval:
  // Air-cooled scooter: 2,500 km
  // Liquid-cooled scooter/manual: 3,500 - 4,000 km
  const engineOilInterval = isScooter
    ? (isLiquidCooled ? 3500 : 2500)
    : (isLiquidCooled ? 3500 : 3000);

  const reminders: MaintenanceReminder[] = [
    // 1. Engine Oil Service
    {
      id: `rem-oil-${Date.now()}-1`,
      bikeId,
      title: 'Engine Oil & Filter Service',
      category: 'Engine Oil',
      intervalKm: engineOilInterval,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + engineOilInterval,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'high',
      notes: `OEM Spec: ${modelPreset.oilViscosity}. Capacity: ${modelPreset.oilCapacityLiters}L. Check drain plug washer.`,
      estimatedCostPhp: isScooter ? 380 : 450,
    },
  ];

  // 2. Scooter Specific: Gear Oil & CVT
  if (isScooter) {
    const gearOilInterval = engineOilInterval * 2; // Every 2 engine oil cycles
    reminders.push({
      id: `rem-gear-${Date.now()}-2`,
      bikeId,
      title: 'Transmission Final Gear Oil',
      category: 'Gear Oil',
      intervalKm: gearOilInterval,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + gearOilInterval,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'high',
      notes: `Capacity: ${modelPreset.gearOilCapacityMl || 120} ml. Replace every 2 engine oil changes.`,
      estimatedCostPhp: 120,
    });

    reminders.push({
      id: `rem-cvt-${Date.now()}-3`,
      bikeId,
      title: 'CVT Drive Belt & Flyball Roller Cleaning',
      category: 'CVT & Belt',
      intervalKm: 8000,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + 8000,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'medium',
      notes: 'Inspect belt width & dry rot cracks. Clean clutch bell dust and check roller weight flat spots.',
      estimatedCostPhp: 350,
    });
  }

  // 3. Chain Drive Bikes
  if (isChainDrive) {
    reminders.push({
      id: `rem-chain-clean-${Date.now()}-4`,
      bikeId,
      title: 'Drive Chain Clean & Lube',
      category: 'Drive Chain',
      intervalKm: 800,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + 800,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'high',
      notes: 'Scrub with chain brush and kerosene/degreaser, dry, and apply O-ring safe chain lube.',
      estimatedCostPhp: 150,
    });

    reminders.push({
      id: `rem-chain-tension-${Date.now()}-5`,
      bikeId,
      title: 'Drive Chain Slack & Tension Adjustment',
      category: 'Drive Chain',
      intervalKm: 2000,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + 2000,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'medium',
      notes: `Target slack: ${modelPreset.chainSlackMm || '25 - 35 mm'} mid-point deflection. Align axle markers.`,
      estimatedCostPhp: 80,
    });
  }

  // 4. Spark Plug (Universal)
  reminders.push({
    id: `rem-plug-${Date.now()}-6`,
    bikeId,
    title: 'Spark Plug Inspection / Renewal',
    category: 'Spark Plug',
    intervalKm: 8000,
    lastCompletedOdo: currentOdo,
    nextDueOdo: currentOdo + 8000,
    lastCompletedDate: new Date().toISOString().split('T')[0],
    priority: 'medium',
    notes: 'Inspect electrode tip color (chocolate tan is ideal). Gap 0.7 - 0.8 mm. Replace if fouled.',
    estimatedCostPhp: 250,
  });

  // 5. Air Filter
  reminders.push({
    id: `rem-air-${Date.now()}-7`,
    bikeId,
    title: 'Viscous Air Cleaner Filter Replacement',
    category: 'Air Filter',
    intervalKm: 12000,
    lastCompletedOdo: currentOdo,
    nextDueOdo: currentOdo + 12000,
    lastCompletedDate: new Date().toISOString().split('T')[0],
    priority: 'medium',
    notes: 'Do NOT clean with pressurized air if oil-soaked viscous paper. Replace with OEM filter.',
    estimatedCostPhp: 320,
  });

  // 6. Liquid Cooled Models: Coolant Flush
  if (isLiquidCooled) {
    reminders.push({
      id: `rem-coolant-${Date.now()}-8`,
      bikeId,
      title: 'Radiator Coolant System Flush',
      category: 'Coolant',
      intervalKm: 14000,
      lastCompletedOdo: currentOdo,
      nextDueOdo: currentOdo + 14000,
      lastCompletedDate: new Date().toISOString().split('T')[0],
      priority: 'medium',
      notes: 'Drain coolant from bleed screw, flush reserve tank, refill 50/50 ethylene glycol pre-mix.',
      estimatedCostPhp: 350,
    });
  }

  // 7. Valve Clearance Inspection
  reminders.push({
    id: `rem-valve-${Date.now()}-9`,
    bikeId,
    title: 'Engine Valve Clearance (Tappet Check)',
    category: 'Valve Clearance',
    intervalKm: 12000,
    lastCompletedOdo: currentOdo,
    nextDueOdo: currentOdo + 12000,
    lastCompletedDate: new Date().toISOString().split('T')[0],
    priority: 'high',
    notes: 'Perform when engine is completely cold (< 35°C). Prevents hard starting and valve burning.',
    estimatedCostPhp: 600,
  });

  // 8. Brakes & Fluid
  reminders.push({
    id: `rem-brakes-${Date.now()}-10`,
    bikeId,
    title: 'Brake Pads Wear & Disc Thickness Check',
    category: 'Brakes',
    intervalKm: 3500,
    lastCompletedOdo: currentOdo,
    nextDueOdo: currentOdo + 3500,
    lastCompletedDate: new Date().toISOString().split('T')[0],
    priority: 'high',
    notes: 'Check groove depth on calipers. Replace before metal backing touches rotor disc.',
    estimatedCostPhp: 400,
  });

  reminders.push({
    id: `rem-brakefluid-${Date.now()}-11`,
    bikeId,
    title: 'Brake Fluid Flush & Bleed (DOT 3 / DOT 4)',
    category: 'Brakes',
    intervalKm: 12000,
    lastCompletedOdo: currentOdo,
    nextDueOdo: currentOdo + 12000,
    lastCompletedDate: new Date().toISOString().split('T')[0],
    priority: 'medium',
    notes: 'Flush master cylinder and brake line to prevent moisture boiling and spongy lever.',
    estimatedCostPhp: 300,
  });

  return reminders;
}

/**
 * Synthesizes a PhilippineModelPreset for a custom-registered motorcycle
 * so that custom motorcycles receive tailored default maintenance reminders
 * matching their transmission, displacement, and cooling specs.
 */
export function buildPresetFromCustomMotorcycle(bike: {
  brand: string;
  model: string;
  year: number;
  motorcycleType?: string;
  specs?: {
    transmission?: TransmissionType;
    cooling?: EngineCooling;
    displacementCc?: number;
    oilViscosity?: string;
    oilCapacityLiters?: number;
    gearOilCapacityMl?: number;
    tirePressureFrontPsi?: number;
    tirePressureRearPsi?: number;
    recommendedServiceIntervalKm?: number;
  };
}): PhilippineModelPreset {
  const cc = Number(bike.specs?.displacementCc) || 150;
  const rawType = (bike.motorcycleType || '').toLowerCase();
  const transmission: TransmissionType =
    bike.specs?.transmission ||
    (rawType.includes('scooter')
      ? 'Automatic Scooter'
      : rawType.includes('underbone')
      ? 'Semi-Auto Underbone'
      : 'Manual');
  const cooling: EngineCooling =
    bike.specs?.cooling || (cc >= 150 ? 'Liquid-Cooled' : 'Air-Cooled');
  const isScooter = transmission === 'Automatic Scooter';

  return {
    brand: bike.brand || 'Custom',
    model: bike.model || 'Motorcycle',
    year: Number(bike.year) || new Date().getFullYear(),
    transmission,
    cooling,
    displacementCc: cc,
    oilViscosity:
      bike.specs?.oilViscosity ||
      (isScooter ? '10W-40 JASO MB' : '10W-40 JASO MA2'),
    oilCapacityLiters:
      bike.specs?.oilCapacityLiters ||
      (cc >= 400 ? 2.4 : cc >= 200 ? 1.4 : 0.9),
    gearOilCapacityMl: isScooter
      ? bike.specs?.gearOilCapacityMl || 150
      : undefined,
    tirePressureFrontPsi: bike.specs?.tirePressureFrontPsi || 29,
    tirePressureRearPsi: bike.specs?.tirePressureRearPsi || 33,
    chainSlackMm: isScooter ? undefined : '25 - 35 mm',
    recommendedServiceIntervalKm:
      bike.specs?.recommendedServiceIntervalKm || 3000,
    description: `Custom registered ${bike.brand} ${bike.model} (${cc}cc).`,
  };
}

