class NotificationPreferences {
  const NotificationPreferences({
    this.carActivity = true,
    this.shipmentActivity = true,
    this.walletActivity = true,
    this.businessActivity = true,
  });

  final bool carActivity;
  final bool shipmentActivity;
  final bool walletActivity;
  final bool businessActivity;

  static const defaults = NotificationPreferences();

  factory NotificationPreferences.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaults;
    return NotificationPreferences(
      carActivity: data['carActivity'] != false,
      shipmentActivity: data['shipmentActivity'] != false,
      walletActivity: data['walletActivity'] != false,
      businessActivity: data['businessActivity'] != false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'carActivity': carActivity,
      'shipmentActivity': shipmentActivity,
      'walletActivity': walletActivity,
      'businessActivity': businessActivity,
    };
  }

  NotificationPreferences copyWith({
    bool? carActivity,
    bool? shipmentActivity,
    bool? walletActivity,
    bool? businessActivity,
  }) {
    return NotificationPreferences(
      carActivity: carActivity ?? this.carActivity,
      shipmentActivity: shipmentActivity ?? this.shipmentActivity,
      walletActivity: walletActivity ?? this.walletActivity,
      businessActivity: businessActivity ?? this.businessActivity,
    );
  }
}
