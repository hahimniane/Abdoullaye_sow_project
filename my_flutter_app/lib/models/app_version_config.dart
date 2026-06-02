enum AppUpdateRequirement { current, updateAvailable, forceUpdate }

class AppVersionConfig {
  const AppVersionConfig({
    this.enabled = true,
    this.latestBuild = const {},
    this.minSupportedBuild = const {},
    this.updateUrl = const {},
    this.latestVersionName,
    this.updateMessageEn,
    this.updateMessageFr,
  });

  final bool enabled;
  final Map<String, int> latestBuild;
  final Map<String, int> minSupportedBuild;
  final Map<String, String> updateUrl;
  final String? latestVersionName;
  final String? updateMessageEn;
  final String? updateMessageFr;

  factory AppVersionConfig.fromMap(Map<String, dynamic> data) {
    return AppVersionConfig(
      enabled: data['enabled'] != false,
      latestBuild: _intMap(data['latestBuild']),
      minSupportedBuild: _intMap(data['minSupportedBuild']),
      updateUrl: _stringMap(data['updateUrl']),
      latestVersionName: data['latestVersionName'] as String?,
      updateMessageEn: data['updateMessageEn'] as String?,
      updateMessageFr: data['updateMessageFr'] as String?,
    );
  }

  AppVersionDecision evaluate({
    required String platformKey,
    required int currentBuild,
  }) {
    final latest = _platformInt(latestBuild, platformKey);
    final minimum = _platformInt(minSupportedBuild, platformKey);
    final url = _platformString(updateUrl, platformKey);

    if (!enabled) {
      return AppVersionDecision(
        requirement: AppUpdateRequirement.current,
        currentBuild: currentBuild,
        latestBuild: latest,
        minSupportedBuild: minimum,
        updateUrl: url,
        latestVersionName: latestVersionName,
        updateMessageEn: updateMessageEn,
        updateMessageFr: updateMessageFr,
      );
    }

    final requirement = currentBuild < minimum
        ? AppUpdateRequirement.forceUpdate
        : currentBuild < latest
        ? AppUpdateRequirement.updateAvailable
        : AppUpdateRequirement.current;

    return AppVersionDecision(
      requirement: requirement,
      currentBuild: currentBuild,
      latestBuild: latest,
      minSupportedBuild: minimum,
      updateUrl: url,
      latestVersionName: latestVersionName,
      updateMessageEn: updateMessageEn,
      updateMessageFr: updateMessageFr,
    );
  }

  static Map<String, int> _intMap(dynamic raw) {
    if (raw is! Map) return const {};
    return {
      for (final entry in raw.entries)
        if (_toInt(entry.value) != null)
          entry.key.toString(): _toInt(entry.value)!,
    };
  }

  static Map<String, String> _stringMap(dynamic raw) {
    if (raw is! Map) return const {};
    return {
      for (final entry in raw.entries)
        if (entry.value != null) entry.key.toString(): entry.value.toString(),
    };
  }

  static int _platformInt(Map<String, int> values, String platformKey) {
    return values[platformKey] ?? values['all'] ?? 0;
  }

  static String? _platformString(
    Map<String, String> values,
    String platformKey,
  ) {
    return values[platformKey] ?? values['all'];
  }

  static int? _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}

class AppVersionDecision {
  const AppVersionDecision({
    required this.requirement,
    required this.currentBuild,
    required this.latestBuild,
    required this.minSupportedBuild,
    this.updateUrl,
    this.latestVersionName,
    this.updateMessageEn,
    this.updateMessageFr,
  });

  final AppUpdateRequirement requirement;
  final int currentBuild;
  final int latestBuild;
  final int minSupportedBuild;
  final String? updateUrl;
  final String? latestVersionName;
  final String? updateMessageEn;
  final String? updateMessageFr;
}
