class NotificationPreferences {
  const NotificationPreferences({
    this.pushNotifications = true,
    this.emailNotifications = true,
    this.smsNotifications = false,
    this.carActivity = true,
    this.shipmentActivity = true,
    this.businessActivity = true,
    this.reviewActivity = true,
    this.supportActivity = true,
    this.supportMessages = true,
    this.supportEscalations = true,
    this.supportCaseUpdates = true,
  });

  final bool pushNotifications;
  final bool emailNotifications;
  final bool smsNotifications;
  final bool carActivity;
  final bool shipmentActivity;
  final bool businessActivity;
  final bool reviewActivity;
  final bool supportActivity;
  final bool supportMessages;
  final bool supportEscalations;
  final bool supportCaseUpdates;

  static const defaults = NotificationPreferences();

  factory NotificationPreferences.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaults;
    return NotificationPreferences(
      pushNotifications: data['pushNotifications'] != false,
      emailNotifications: data['emailNotifications'] != false,
      smsNotifications: data['smsNotifications'] == true,
      carActivity: data['carActivity'] != false,
      shipmentActivity: data['shipmentActivity'] != false,
      businessActivity: data['businessActivity'] != false,
      reviewActivity: data['reviewActivity'] != false,
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
      'pushNotifications': pushNotifications,
      'emailNotifications': emailNotifications,
      'smsNotifications': smsNotifications,
      'carActivity': carActivity,
      'shipmentActivity': shipmentActivity,
      'businessActivity': businessActivity,
      'reviewActivity': reviewActivity,
      'supportActivity': supportActivity,
      'supportMessages': supportMessages,
      'supportEscalations': supportEscalations,
      'supportCaseUpdates': supportCaseUpdates,
    };
  }

  NotificationPreferences copyWith({
    bool? pushNotifications,
    bool? emailNotifications,
    bool? smsNotifications,
    bool? carActivity,
    bool? shipmentActivity,
    bool? businessActivity,
    bool? reviewActivity,
    bool? supportActivity,
    bool? supportMessages,
    bool? supportEscalations,
    bool? supportCaseUpdates,
  }) {
    return NotificationPreferences(
      pushNotifications: pushNotifications ?? this.pushNotifications,
      emailNotifications: emailNotifications ?? this.emailNotifications,
      smsNotifications: smsNotifications ?? this.smsNotifications,
      carActivity: carActivity ?? this.carActivity,
      shipmentActivity: shipmentActivity ?? this.shipmentActivity,
      businessActivity: businessActivity ?? this.businessActivity,
      reviewActivity: reviewActivity ?? this.reviewActivity,
      supportActivity: supportActivity ?? this.supportActivity,
      supportMessages: supportMessages ?? this.supportMessages,
      supportEscalations: supportEscalations ?? this.supportEscalations,
      supportCaseUpdates: supportCaseUpdates ?? this.supportCaseUpdates,
    );
  }
}
