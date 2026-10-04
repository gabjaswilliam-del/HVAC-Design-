// English interface text. A Chinese catalog will implement the same `Messages` shape;
// equipment labels and document content are data, not interface text, and are not here.
export const en = {
  app: {
    productName: "HVAC Agent",
    siteLabel: "Synthetic demo plant",
    skipToContent: "Skip to content",
  },
  dataMode: {
    demo: "Demo data",
    demoDescription:
      "All readings, forecasts, documents and agent responses on this screen are synthetic. Nothing is connected to site equipment or a model.",
    notConnectedTitle: "Local API not connected",
    notConnectedBody:
      "This build has no connection to the local API yet. The only available mode is the explicitly selected demo: run `npm run demo`.",
  },
  header: {
    source: "Source",
    demoReplay: "Demo replay",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
  },
  nav: {
    label: "Main navigation",
    groups: {
      operation: "Operation",
      engineering: "Engineering",
      administration: "Administration",
    },
    monitoring: "Monitoring",
    equipment: "Equipment",
    prediction: "Cooling prediction",
    agent: "AI assistant",
    simulation: "Simulation",
    pilot: "AI pilot",
    cad: "CAD Studio",
    knowledge: "Knowledge base",
    setup: "Installation",
    system: "System",
  },
  monitoring: {
    heading: "Monitoring",
    sceneTitle: "Plant schematic",
    topologyNotice:
      "Synthetic demonstration topology. It is not a customer site and is not simulated by PHYVAC.",
    previewNotice: "Artwork review preview: static readings, no interaction yet.",
    legend: {
      heading: "Legend",
      media: "Pipe media",
      cwHot: "Condenser water to towers",
      cwCool: "Condenser water from towers",
      chwSupply: "Chilled-water supply",
      chwReturn: "Chilled-water return",
      unknownLink: "Connection not recorded",
      states: "Equipment state",
      tags: "Readings",
      frequency: "Frequency",
      power: "Electrical power",
      temperature: "Temperature",
      hydraulic: "Pressure and flow",
      neutral: "Load and thermal kW",
    },
  },
  scene: {
    states: {
      running: "Running",
      stopped: "Stopped",
      fault: "Fault",
      unavailable: "No data",
      stale: "Stale",
    },
    valueUnavailable: "Unavailable",
    staleValue: "Stale value",
  },
  planned: {
    heading: "In development",
    body: "This screen is part of the Version A prototype and is built in a later milestone.",
    milestone: "Milestone",
  },
  notFound: {
    heading: "Page not found",
    body: "No screen exists at this address.",
    back: "Go to monitoring",
  },
};

export type Messages = typeof en;
