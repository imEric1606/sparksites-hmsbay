// config.js — Single source of truth for site branding and theme.
// Edit ONLY this file to rebrand the entire site.

export const SITE_CONFIG = {
  name: "HMSBay",
  tagline: "Your School Marketplace",
  primaryColor: "#003087",
  accentColor:  "#F5AF02",
  contactEmail: "admin@hmsbay.com",
  minBidIncrement: 0.25,
  categories: [
    "Books & Stationery",
    "Electronics",
    "Sports & PE",
    "Art & Crafts",
    "Clothing & Uniform",
    "Food & Treats",
    "Games & Toys",
    "Services",
    "Other"
  ],
  conditions: ["New", "Like New", "Good", "Fair", "Poor"],
  auctionDurations: [
    { label: "1 Hour",   seconds: 3600 },
    { label: "6 Hours",  seconds: 21600 },
    { label: "12 Hours", seconds: 43200 },
    { label: "24 Hours", seconds: 86400 },
    { label: "48 Hours", seconds: 172800 },
    { label: "7 Days",   seconds: 604800 }
  ]
};
