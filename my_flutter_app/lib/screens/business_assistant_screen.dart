import 'dart:convert';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_assistant_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';

enum _ActionStatus { pending, confirmed, declined }

/// One rendered row of the conversation. Plain data held by the screen State —
/// never inside lazily built list children (which get disposed on scroll).
class _ChatEntry {
  _ChatEntry.user(this.text)
      : fromUser = true,
        isError = false,
        action = null;

  _ChatEntry.assistant(this.text)
      : fromUser = false,
        isError = false,
        action = null;

  _ChatEntry.error(this.text)
      : fromUser = false,
        isError = true,
        action = null;

  _ChatEntry.actionCard(BusinessAssistantProposedAction this.action)
      : fromUser = false,
        isError = false,
        text = '';

  final bool fromUser;
  final bool isError;
  final String text;
  final BusinessAssistantProposedAction? action;
  _ActionStatus actionStatus = _ActionStatus.pending;
}

/// Business-facing AI assistant chat. Talks to the `businessAssistantChat`
/// callable; any side-effectful action the assistant proposes is rendered as
/// an inline confirmation card and only runs after an explicit Confirm.
///
/// Errors are shown inline in the chat (not via snackbars — see the teal
/// error-snackbar defect elsewhere in the app).
class BusinessAssistantScreen extends StatefulWidget {
  const BusinessAssistantScreen({
    super.key,
    required this.businessId,
    this.client,
  });

  final String businessId;

  /// Injectable backend boundary so widget tests can run without Firebase.
  final BusinessAssistantClient? client;

  @override
  State<BusinessAssistantScreen> createState() =>
      _BusinessAssistantScreenState();
}

class _BusinessAssistantScreenState extends State<BusinessAssistantScreen> {
  late final BusinessAssistantClient _client;
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  /// Canonical conversation state from the backend. To send a new message we
  /// append a user turn and call the function again.
  List<Map<String, dynamic>> _transcript = <Map<String, dynamic>>[];
  final List<_ChatEntry> _entries = <_ChatEntry>[];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _client = widget.client ?? FirebaseBusinessAssistantClient();
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  bool get _hasPendingAction => _entries.any(
        (entry) =>
            entry.action != null && entry.actionStatus == _ActionStatus.pending,
      );

  void _applyResponse(BusinessAssistantResponse response) {
    _transcript = response.transcript;
    if (response.reply.trim().isNotEmpty) {
      _entries.add(_ChatEntry.assistant(response.reply));
    }
    final action = response.proposedAction;
    if (action != null) {
      _entries.add(_ChatEntry.actionCard(action));
    }
  }

  String _describeError(Object error) {
    final l10n = AppLocalizations.of(context)!;
    if (error is FirebaseFunctionsException) {
      final message = error.message?.trim() ?? '';
      return message.isEmpty ? l10n.businessAssistantError : message;
    }
    return l10n.businessAssistantError;
  }

  Future<void> _sendMessage() async {
    final text = _inputController.text.trim();
    if (text.isEmpty || _busy || _hasPendingAction) return;
    _inputController.clear();
    final messages = <Map<String, dynamic>>[
      ..._transcript,
      <String, dynamic>{'role': 'user', 'content': text},
    ];
    setState(() {
      _entries.add(_ChatEntry.user(text));
      _busy = true;
    });
    _scrollToBottom();
    try {
      final response = await _client.sendTranscript(
        businessId: widget.businessId,
        messages: messages,
      );
      if (!mounted) return;
      setState(() => _applyResponse(response));
    } catch (error) {
      if (!mounted) return;
      setState(() => _entries.add(_ChatEntry.error(_describeError(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToBottom();
    }
  }

  Future<void> _resolveAction(_ChatEntry entry, {required bool confirm}) async {
    final action = entry.action;
    if (action == null ||
        entry.actionStatus != _ActionStatus.pending ||
        _busy) {
      return;
    }
    setState(() => _busy = true);

    String resultContent;
    var resultIsError = false;
    if (confirm) {
      try {
        final result = await _client.runAction(
          callable: action.callable,
          params: action.params,
        );
        resultContent =
            jsonEncode(result.isEmpty ? <String, dynamic>{'success': true} : result);
      } on FirebaseFunctionsException catch (error) {
        resultContent = error.message?.trim().isNotEmpty == true
            ? error.message!.trim()
            : error.code;
        resultIsError = true;
      } catch (error) {
        resultContent = error.toString();
        resultIsError = true;
      }
    } else {
      resultContent = 'Declined by the staff member.';
      resultIsError = true;
    }

    if (!mounted) return;
    setState(() {
      entry.actionStatus =
          confirm ? _ActionStatus.confirmed : _ActionStatus.declined;
    });
    _scrollToBottom();

    final messages = <Map<String, dynamic>>[
      ..._transcript,
      <String, dynamic>{
        'role': 'user',
        'content': <Map<String, dynamic>>[
          <String, dynamic>{
            'type': 'tool_result',
            'tool_use_id': action.toolUseId,
            'content': resultContent,
            if (resultIsError) 'is_error': true,
          },
        ],
      },
    ];
    try {
      final response = await _client.sendTranscript(
        businessId: widget.businessId,
        messages: messages,
      );
      if (!mounted) return;
      setState(() => _applyResponse(response));
    } catch (error) {
      if (!mounted) return;
      setState(() => _entries.add(_ChatEntry.error(_describeError(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final inputEnabled = !_busy && !_hasPendingAction;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        backgroundColor: AppColors.cream,
        elevation: 0,
        leading: const AppBackButton(),
        title: Text(
          l10n.businessAssistantTitle,
          style: const TextStyle(
            color: AppColors.ink,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _entries.isEmpty
                  ? _EmptyState(l10n: l10n)
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                      itemCount: _entries.length,
                      itemBuilder: (context, index) {
                        final entry = _entries[index];
                        if (entry.action != null) {
                          return _ActionCard(
                            key: ValueKey('assistant-action-$index'),
                            l10n: l10n,
                            action: entry.action!,
                            status: entry.actionStatus,
                            busy: _busy,
                            onConfirm: () =>
                                _resolveAction(entry, confirm: true),
                            onCancel: () =>
                                _resolveAction(entry, confirm: false),
                          );
                        }
                        return _MessageBubble(entry: entry);
                      },
                    ),
            ),
            if (_busy)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: LinearProgressIndicator(
                  minHeight: 3,
                  color: AppColors.cobalt,
                  backgroundColor: AppColors.rule,
                ),
              ),
            _InputBar(
              l10n: l10n,
              controller: _inputController,
              enabled: inputEnabled,
              onSend: _sendMessage,
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    Widget capability(IconData icon, String text) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: AppColors.cobalt),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: const TextStyle(
                  color: AppColors.ink,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 24),
          const Icon(
            Icons.support_agent,
            size: 44,
            color: AppColors.cobalt,
          ),
          const SizedBox(height: 16),
          Text(
            l10n.businessAssistantEmptyTitle,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 22,
              fontWeight: FontWeight.w800,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.businessAssistantEmptyHint,
            style: const TextStyle(color: AppColors.muted, height: 1.5),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border.all(color: AppColors.rule),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                capability(
                  Icons.local_parking,
                  l10n.businessAssistantCapabilityParkedCars,
                ),
                capability(
                  Icons.directions_car_outlined,
                  l10n.businessAssistantCapabilityWalkUp,
                ),
                capability(
                  Icons.local_shipping_outlined,
                  l10n.businessAssistantCapabilityTracking,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.entry});

  final _ChatEntry entry;

  @override
  Widget build(BuildContext context) {
    final fromUser = entry.fromUser;
    final Color background;
    final Color foreground;
    if (entry.isError) {
      background = AppColors.errorRed.withValues(alpha: 0.08);
      foreground = AppColors.errorRed;
    } else if (fromUser) {
      background = AppColors.cobalt;
      foreground = Colors.white;
    } else {
      background = AppColors.paper;
      foreground = AppColors.ink;
    }
    return Align(
      alignment: fromUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.78,
        ),
        decoration: BoxDecoration(
          color: background,
          border: entry.isError
              ? Border.all(color: AppColors.errorRed.withValues(alpha: 0.4))
              : (fromUser ? null : Border.all(color: AppColors.rule)),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(14),
            topRight: const Radius.circular(14),
            bottomLeft: Radius.circular(fromUser ? 14 : 4),
            bottomRight: Radius.circular(fromUser ? 4 : 14),
          ),
        ),
        child: Text(
          entry.text,
          style: TextStyle(color: foreground, height: 1.4),
        ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    super.key,
    required this.l10n,
    required this.action,
    required this.status,
    required this.busy,
    required this.onConfirm,
    required this.onCancel,
  });

  final AppLocalizations l10n;
  final BusinessAssistantProposedAction action;
  final _ActionStatus status;
  final bool busy;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final rows = action.params.entries
        .where((entry) => entry.key != 'businessId')
        .toList();
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.all(14),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.88,
        ),
        decoration: BoxDecoration(
          color: AppColors.paper,
          border: Border.all(color: AppColors.cobalt.withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.task_alt,
                  size: 18,
                  color: AppColors.cobalt,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    action.title,
                    style: const TextStyle(
                      color: AppColors.ink,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            if (rows.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final row in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 2,
                        child: Text(
                          row.key,
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      Expanded(
                        flex: 3,
                        child: Text(
                          '${row.value}',
                          style: const TextStyle(
                            color: AppColors.ink,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: 10),
            if (status == _ActionStatus.pending)
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      key: const Key('assistant-action-confirm'),
                      onPressed: busy ? null : onConfirm,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.cobalt,
                      ),
                      child: Text(l10n.businessAssistantConfirm),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton(
                      key: const Key('assistant-action-cancel'),
                      onPressed: busy ? null : onCancel,
                      child: Text(l10n.businessAssistantCancel),
                    ),
                  ),
                ],
              )
            else
              Row(
                children: [
                  Icon(
                    status == _ActionStatus.confirmed
                        ? Icons.check_circle
                        : Icons.cancel,
                    size: 18,
                    color: status == _ActionStatus.confirmed
                        ? AppColors.sage
                        : AppColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    status == _ActionStatus.confirmed
                        ? l10n.businessAssistantConfirmed
                        : l10n.businessAssistantDeclined,
                    style: TextStyle(
                      color: status == _ActionStatus.confirmed
                          ? AppColors.sage
                          : AppColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _InputBar extends StatelessWidget {
  const _InputBar({
    required this.l10n,
    required this.controller,
    required this.enabled,
    required this.onSend,
  });

  final AppLocalizations l10n;
  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: const BoxDecoration(
        color: AppColors.paper,
        border: Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              key: const Key('assistant-input'),
              controller: controller,
              enabled: enabled,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
              decoration: InputDecoration(
                hintText: l10n.businessAssistantInputHint,
                hintStyle: const TextStyle(color: AppColors.muted),
                filled: true,
                fillColor: AppColors.parchment,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(22),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            key: const Key('assistant-send'),
            tooltip: l10n.businessAssistantSend,
            onPressed: enabled ? onSend : null,
            style: IconButton.styleFrom(backgroundColor: AppColors.cobalt),
            icon: const Icon(Icons.arrow_upward, color: Colors.white),
          ),
        ],
      ),
    );
  }
}
