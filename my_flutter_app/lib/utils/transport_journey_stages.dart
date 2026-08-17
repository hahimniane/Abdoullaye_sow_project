/// A transported car's journey, as the customer thinks about it.
///
/// Mirrors `admin_web/src/lib/tracking-journey.ts` (TRANSPORT_JOURNEY_STAGES /
/// transportJourneyStageFor) - all three clients must agree on where a job
/// stands or the web and the app would tell the same customer two stories.
library;

class TransportJourneyStage {
  const TransportJourneyStage({required this.label, required this.hint});

  final String label;
  final String hint;
}

const transportJourneyStages = <TransportJourneyStage>[
  TransportJourneyStage(label: 'Booked', hint: 'Carrier chosen and paid'),
  TransportJourneyStage(label: 'Scheduled', hint: 'Pickup is arranged'),
  TransportJourneyStage(label: 'On its way', hint: 'Your car is travelling'),
  TransportJourneyStage(label: 'Delivered', hint: 'Handed over'),
];

const _stageByStatus = <String, int>{
  'quote_requested': 0,
  'pending_payment': 0,
  'pending': 0,
  'scheduled': 1,
  'in_transit': 2,
  'delivered': 3,
};

/// The stage index for a job status, or -1 for a cancelled job - a stalled
/// progress bar reads as broken, so cancelled jobs show none at all.
int transportJourneyStageIndex(String status) {
  final key = status.trim();
  if (key == 'cancelled') return -1;
  return _stageByStatus[key] ?? 0;
}
