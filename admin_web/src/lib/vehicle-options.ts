// Vehicle option vocabularies, shared by the business listing form and the
// customer marketplace. They live here rather than in operations-panels
// because the guest marketplace needs only these few lists, and importing them
// from that 9,000-line panel module pulled the whole business console onto the
// first page a visitor sees.

import { currentLanguage } from "@/lib/format";

export const conditionOptions = ["new", "used", "certified", "salvage"];
export const bodyTypeOptions = ["sedan", "suv", "truck", "van", "coupe", "hatchback", "wagon", "convertible"];
export const transmissionOptions = ["automatic", "manual", "cvt"];
export const fuelOptions = ["gas", "diesel", "hybrid", "electric", "plug_in_hybrid"];
export const drivetrainOptions = ["fwd", "rwd", "awd", "4wd"];

export const ACRONYMS = new Set(["suv", "cvt", "vin", "fwd", "rwd", "awd", "4wd"]);

export function optionLabel(value: string) {
  const labels: Record<"en" | "fr", Record<string, string>> = {
    en: {
      automatic: "Automatic",
      backup_camera: "Backup camera",
      beige: "Beige",
      black: "Black",
      blind_spot: "Blind spot",
      bluetooth: "Bluetooth",
      brown: "Brown",
      certified: "Certified",
      convertible: "Convertible",
      coupe: "Coupe",
      diesel: "Diesel",
      electric: "Electric",
      gas: "Gas",
      gold: "Gold",
      gray: "Gray",
      green: "Green",
      hatchback: "Hatchback",
      heated_seats: "Heated seats",
      hybrid: "Hybrid",
      keyless_entry: "Keyless entry",
      leather_seats: "Leather seats",
      manual: "Manual",
      navigation: "Navigation",
      new: "New",
      orange: "Orange",
      other: "Other",
      plug_in_hybrid: "Plug-in hybrid",
      purple: "Purple",
      red: "Red",
      remote_start: "Remote start",
      salvage: "Salvage",
      sedan: "Sedan",
      silver: "Silver",
      sunroof: "Sunroof",
      third_row: "Third row",
      truck: "Truck",
      used: "Used",
      van: "Van",
      wagon: "Wagon",
      white: "White",
      yellow: "Yellow",
    },
    fr: {
      automatic: "Automatique",
      backup_camera: "Caméra de recul",
      beige: "Beige",
      black: "Noir",
      blind_spot: "Détection angle mort",
      bluetooth: "Bluetooth",
      brown: "Marron",
      certified: "Certifié",
      convertible: "Cabriolet",
      coupe: "Coupé",
      diesel: "Diesel",
      electric: "Électrique",
      gas: "Essence",
      gold: "Or",
      gray: "Gris",
      green: "Vert",
      hatchback: "Hatchback",
      heated_seats: "Sièges chauffants",
      hybrid: "Hybride",
      keyless_entry: "Accès sans clé",
      leather_seats: "Sièges en cuir",
      manual: "Manuelle",
      navigation: "Navigation",
      new: "Neuf",
      orange: "Orange",
      other: "Autre",
      plug_in_hybrid: "Hybride rechargeable",
      purple: "Violet",
      red: "Rouge",
      remote_start: "Démarrage à distance",
      salvage: "Accidenté",
      sedan: "Berline",
      silver: "Argent",
      sunroof: "Toit ouvrant",
      third_row: "Troisième rangée",
      truck: "Pick-up",
      used: "Occasion",
      van: "Van",
      wagon: "Break",
      white: "Blanc",
      yellow: "Jaune",
    },
  };
  const language = currentLanguage();
  if (labels[language][value]) return labels[language][value];
  if (!value) return "";
  if (ACRONYMS.has(value.toLowerCase())) return value.toUpperCase();
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
