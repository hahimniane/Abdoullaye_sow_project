class NotificationPreferences {
  const NotificationPreferences({
    this.carActivity = true,
    this.shipmentActivity = true,
    this.walletActivity = true,
    this.businessActivity = true,
    this.supportActivity = true,
    this.supportMessages = true,
    this.supportEscalations = true,
    this.supportCaseUpdates = true,
  });

  final bool carActivity;
  final bool shipmentActivity;
  final bool walletActivity;
  final bool businessActivity;
  final bool supportActivity;
  final bool supportMessages;
  final bool supportEscalations;
  final bool supportCaseUpdates;

  static const defaults = NotificationPreferences();

  factory NotificationPreferences.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaults;
    return NotificationPreferences(
      carActivity: data['carActivity'] != false,
      shipmentActivity: data['shipmentActivity'] != false,
      walletActivity: data['walletActivity'] != false,
      businessActivity: data['businessActivity'] != false,
      supportActivity: data['supportActivity'] != false,
      supportMessages:
          data['supportMessages'] != false && data['supportActivity'] != false,
      supportEscalations:
          data['supportEscalations'] != false &&
          data['supportActivity'] != false,
      supportCaseUpdates:
          data['supportCaseUpdates'] != false &&
          data['supportActivity'] != false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'carActivity': carActivity,
      'shipmentActivity': shipmentActivity,
      'walletActivity': walletActivity,
      'businessActivity': businessActivity,
      'supportActivity': supportActivity,
      'supportMessages': supportMessages,
      'supportEscalations': supportEscalations,
      'supportCaseUpdates': supportCaseUpdates,
    };
  }

  NotificationPreferences copyWith({
    bool? carActivity,
    bool? shipmentActivity,
    bool? walletActivity,
    bool? businessActivity,
    bool? supportActivity,
    bool? supportMessages,
    bool? supportEscalations,
    bool? supportCaseUpdates,
  }) {
    return NotificationPreferences(
      carActivity: carActivity ?? this.carActivity,
      shipmentActivity: shipmentActivity ?? this.shipmentActivity,
      walletActivity: walletActivity ?? this.walletActivity,
      businessActivity: businessActivity ?? this.businessActivity,
      supportActivity: supportActivity ?? this.supportActivity,
      supportMessages: supportMessages ?? this.supportMessages,
      supportEscalations: supportEscalations ?? this.supportEscalations,
      supportCaseUpdates: supportCaseUpdates ?? this.supportCaseUpdates,
    );
  }
}
