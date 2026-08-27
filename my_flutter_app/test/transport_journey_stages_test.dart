import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/transport_journey_stages.dart';

void main() {
  // Mirrors admin_web/src/lib/tracking-journey.test.ts - all clients must
  // place a job on the same stage or web and app tell two stories.
  test('statuses land on the same stages as the web', () {
    expect(transportJourneyStageIndex('quote_requested'), 0);
    expect(transportJourneyStageIndex('pending_payment'), 0);
    expect(transportJourneyStageIndex('pending'), 0);
    expect(transportJourneyStageIndex('scheduled'), 1);
    expect(transportJourneyStageIndex('in_transit'), 2);
    expect(transportJourneyStageIndex('delivered'), 3);
  });

  test('a cancelled job has no journey, and unknowns start at Booked', () {
    expect(transportJourneyStageIndex('cancelled'), -1);
    expect(transportJourneyStageIndex('held_at_customs'), 0);
    expect(transportJourneyStages.length, 4);
  });
}
