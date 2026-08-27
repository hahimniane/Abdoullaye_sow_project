import 'package:cloud_functions/cloud_functions.dart';

/// Recursively converts the loosely typed maps/lists returned by
/// `cloud_functions` (`Map<Object?, Object?>`) into `Map<String, dynamic>` /
/// `List<dynamic>` structures that can be stored and re-sent as JSON.
dynamic deepCastCallableValue(Object? value) {
  if (value is Map) {
    return value.map<String, dynamic>(
      (key, child) => MapEntry(key.toString(), deepCastCallableValue(child)),
    );
  }
  if (value is List) {
    return value.map<dynamic>(deepCastCallableValue).toList();
  }
  return value;
}

/// An action the assistant wants to run. It must never execute without the
/// staff member explicitly confirming it in the chat.
class BusinessAssistantProposedAction {
  const BusinessAssistantProposedAction({
    required this.toolUseId,
    required this.tool,
    required this.callable,
    required this.section,
    required this.title,
    required this.params,
  });

  factory BusinessAssistantProposedAction.fromMap(Map<String, dynamic> map) {
    return BusinessAssistantProposedAction(
      toolUseId: (map['toolUseId'] ?? '') as String,
      tool: (map['tool'] ?? '') as String,
      callable: (map['callable'] ?? '') as String,
      section: (map['section'] ?? '') as String,
      title: (map['title'] ?? '') as String,
      params: deepCastCallableValue(map['params']) as Map<String, dynamic>? ??
          <String, dynamic>{},
    );
  }

  final String toolUseId;
  final String tool;
  final String callable;
  final String section;
  final String title;
  final Map<String, dynamic> params;
}

/// One turn of the `businessAssistantChat` callable.
class BusinessAssistantResponse {
  const BusinessAssistantResponse({
    required this.reply,
    required this.transcript,
    this.proposedAction,
  });

  factory BusinessAssistantResponse.fromCallable(Object? data) {
    final map = deepCastCallableValue(data) as Map<String, dynamic>? ??
        <String, dynamic>{};
    final rawTranscript = map['transcript'];
    final transcript = <Map<String, dynamic>>[
      if (rawTranscript is List)
        for (final message in rawTranscript)
          if (message is Map<String, dynamic>) message,
    ];
    final rawAction = map['proposedAction'];
    return BusinessAssistantResponse(
      reply: (map['reply'] ?? '') as String,
      transcript: transcript,
      proposedAction: rawAction is Map<String, dynamic>
          ? BusinessAssistantProposedAction.fromMap(rawAction)
          : null,
    );
  }

  final String reply;

  /// Canonical conversation state. Send it back verbatim (plus the new user
  /// turn) on the next call.
  final List<Map<String, dynamic>> transcript;
  final BusinessAssistantProposedAction? proposedAction;
}

/// Backend boundary for the assistant, behind an interface so widget tests can
/// drive the screen without a network — the same shape
/// `BusinessParkingService` and `SupportRepository` already use.
abstract class BusinessAssistantClient {
  /// Calls `businessAssistantChat`. [messages] must end with a user turn.
  Future<BusinessAssistantResponse> sendTranscript({
    required String businessId,
    required List<Map<String, dynamic>> messages,
  });

  /// Runs a confirmed proposed action by callable name with its params
  /// exactly as the backend supplied them.
  Future<Map<String, dynamic>> runAction({
    required String callable,
    required Map<String, dynamic> params,
  });
}

class FirebaseBusinessAssistantClient implements BusinessAssistantClient {
  FirebaseBusinessAssistantClient({FirebaseFunctions? functions})
      : _functionsOverride = functions;

  final FirebaseFunctions? _functionsOverride;

  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  @override
  Future<BusinessAssistantResponse> sendTranscript({
    required String businessId,
    required List<Map<String, dynamic>> messages,
  }) async {
    final response = await _functions
        .httpsCallable('businessAssistantChat')
        .call<Object?>(<String, dynamic>{
      'businessId': businessId,
      'messages': messages,
    });
    return BusinessAssistantResponse.fromCallable(response.data);
  }

  @override
  Future<Map<String, dynamic>> runAction({
    required String callable,
    required Map<String, dynamic> params,
  }) async {
    final response =
        await _functions.httpsCallable(callable).call<Object?>(params);
    return deepCastCallableValue(response.data) as Map<String, dynamic>? ??
        <String, dynamic>{};
  }
}
