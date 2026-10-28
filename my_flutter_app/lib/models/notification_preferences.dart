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
    this.inventorySales = true,
    this.inventoryCredit = true,
    this.inventoryTransfers = true,
    this.parkedCarAlerts = true,
    this.packageAlerts = true,
    this.platformActivity = true,
    this.whatsappMessages,
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

  /// Inventory "Sales at my store": a push when someone else of this
  /// person's store (or business) rings up a sale. On unless switched off.
  final bool inventorySales;

  /// Inventory credit: a push when this person is made the collector of a
  /// credit sale, and when one they collect is overdue. On unless switched
  /// off.
  final bool inventoryCredit;

  /// Inventory "Store transfers": a push when stock is sent to this
  /// person's store (or cancelled), when items of a transfer did not arrive,
  /// and the reminders while one waits. On unless switched off.
  final bool inventoryTransfers;

  /// "Cars parked by my team": a push when someone else of the business
  /// parks a car (owners, and staff with parking). On unless switched off.
  final bool parkedCarAlerts;

  /// "Packages saved by my team": a push when someone else of the business
  /// saves a package (owners, and staff with containers or deliveries). On
  /// unless switched off.
  final bool packageAlerts;

  /// "Platform activity" (platform admins only: superAdmin and
  /// operationsManager): a push when someone in any business parks a car,
  /// saves a package or makes a shop sale, and when someone joins a business
  /// as staff. On unless switched off.
  final bool platformActivity;

  /// "WhatsApp messages": a push when a customer writes on WhatsApp. Null
  /// until the person chooses: then owners (and Laawol admins) hear, staff
  /// do not - so it is never written until it is set, or saving the profile
  /// would freeze today's default. Read it through `whatsAppMessagesOn`.
  final bool? whatsappMessages;

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
      inventorySales: data['inventorySales'] != false,
      inventoryCredit: data['inventoryCredit'] != false,
      inventoryTransfers: data['inventoryTransfers'] != false,
      parkedCarAlerts: data['parkedCarAlerts'] != false,
      packageAlerts: data['packageAlerts'] != false,
      platformActivity: data['platformActivity'] != false,
      whatsappMessages: data['whatsappMessages'] is bool
          ? data['whatsappMessages'] as bool
          : null,
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
      'inventorySales': inventorySales,
      'inventoryCredit': inventoryCredit,
      'inventoryTransfers': inventoryTransfers,
      'parkedCarAlerts': parkedCarAlerts,
      'packageAlerts': packageAlerts,
      'platformActivity': platformActivity,
      'whatsappMessages': ?whatsappMessages,
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
    bool? inventorySales,
    bool? inventoryCredit,
    bool? inventoryTransfers,
    bool? parkedCarAlerts,
    bool? packageAlerts,
    bool? platformActivity,
    bool? whatsappMessages,
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
      inventorySales: inventorySales ?? this.inventorySales,
      inventoryCredit: inventoryCredit ?? this.inventoryCredit,
      inventoryTransfers: inventoryTransfers ?? this.inventoryTransfers,
      parkedCarAlerts: parkedCarAlerts ?? this.parkedCarAlerts,
      packageAlerts: packageAlerts ?? this.packageAlerts,
      platformActivity: platformActivity ?? this.platformActivity,
      whatsappMessages: whatsappMessages ?? this.whatsappMessages,
    );
  }
}
