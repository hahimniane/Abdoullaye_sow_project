import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/notification_preferences.dart';
import 'package:my_flutter_app/utils/phone_number_validator.dart';

void main() {
  test('notification preferences default to important activity enabled', () {
    final prefs = NotificationPreferences.fromMap(null);

    expect(prefs.pushNotifications, isTrue);
    expect(prefs.emailNotifications, isTrue);
    expect(prefs.smsNotifications, isFalse);
    expect(prefs.carActivity, isTrue);
    expect(prefs.shipmentActivity, isTrue);
    expect(prefs.businessActivity, isTrue);
    expect(prefs.reviewActivity, isTrue);
    expect(prefs.supportActivity, isTrue);
    expect(prefs.supportMessages, isTrue);
    expect(prefs.supportEscalations, isTrue);
    expect(prefs.supportCaseUpdates, isTrue);
    expect(prefs.inventorySales, isTrue);
    // A profile saved before the switch existed has it on.
    expect(
      NotificationPreferences.fromMap({'businessActivity': true})
          .inventorySales,
      isTrue,
    );
  });

  test('notification preferences serialize and preserve disabled values', () {
    final prefs = NotificationPreferences.defaults.copyWith(
      shipmentActivity: false,
      smsNotifications: true,
    );

    expect(prefs.toMap(), {
      'pushNotifications': true,
      'emailNotifications': true,
      'smsNotifications': true,
      'carActivity': true,
      'shipmentActivity': false,
      'businessActivity': true,
      'reviewActivity': true,
      'supportActivity': true,
      'supportMessages': true,
      'supportEscalations': true,
      'supportCaseUpdates': true,
      'inventorySales': true,
    });
    expect(
      NotificationPreferences.fromMap(prefs.toMap()).shipmentActivity,
      isFalse,
    );
    expect(
      NotificationPreferences.fromMap(prefs.toMap()).smsNotifications,
      isTrue,
    );
    final supportDisabled = NotificationPreferences.fromMap({
      'supportActivity': false,
    });
    expect(supportDisabled.supportMessages, isFalse);
    expect(supportDisabled.supportEscalations, isFalse);
    expect(supportDisabled.supportCaseUpdates, isFalse);

    final salesOff = NotificationPreferences.defaults.copyWith(
      inventorySales: false,
    );
    expect(salesOff.toMap()['inventorySales'], isFalse);
    expect(
      NotificationPreferences.fromMap(salesOff.toMap()).inventorySales,
      isFalse,
    );
    expect(NotificationPreferences.fromMap(salesOff.toMap()).businessActivity,
        isTrue);
  });

  test('phone alias key keeps only digits for phone sign-in lookup', () {
    expect(PhoneNumberValidator.aliasKey('(202) 555-0184'), '2025550184');
    expect(PhoneNumberValidator.aliasKey('+1 202.555.0184'), '12025550184');
  });
}
