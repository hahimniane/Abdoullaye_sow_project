import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/transport_request_details_screen.dart';

/// A DropdownButton asserts when its value is absent from its items, which
/// renders the whole screen as a red error box rather than the request. The
/// server stamps `fulfillmentStatus: "not_started"` on every new transport
/// request (`functions/index.js`) and `TransportRequest` maps that onto
/// `status`, so a status list without it made every newly created transport
/// request impossible to open.
void main() {
  test('the server\'s initial status is offered', () {
    // Guards the specific regression: new requests arrive as not_started.
    expect(transportStatusOptions, contains('not_started'));
  });

  test('known statuses are offered exactly once', () {
    for (final status in const [
      'not_started',
      'pending',
      'in_transit',
      'completed',
    ]) {
      expect(
        transportStatusChoices(status).where((s) => s == status).length,
        1,
        reason:
            'a duplicated item asserts in DropdownButton just like a missing '
            'one',
      );
    }
  });

  test('a known status does not alter the offered list', () {
    expect(transportStatusChoices('pending'), transportStatusOptions);
  });

  test('an unknown status is folded in so the screen stays readable', () {
    final choices = transportStatusChoices('awaiting_pickup');

    expect(choices, contains('awaiting_pickup'));
    expect(choices.where((s) => s == 'awaiting_pickup').length, 1);
    // The known options must remain selectable so the request can be moved on.
    for (final known in transportStatusOptions) {
      expect(choices, contains(known));
    }
  });

  test('every offered status resolves to a value the dropdown can match', () {
    // Whatever the current value is, it must appear in the items exactly once -
    // this is the invariant DropdownButton asserts on.
    for (final current in const [
      'not_started',
      'pending',
      'in_transit',
      'completed',
      'legacy_value',
      '',
    ]) {
      final matches = transportStatusChoices(
        current,
      ).where((s) => s == current).length;
      expect(
        matches,
        1,
        reason: 'current value "$current" must appear exactly once in items',
      );
    }
  });
}
