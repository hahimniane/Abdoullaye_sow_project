import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/support_case.dart';
import '../models/support_message.dart';
import '../services/container_manifest.dart' show ContainerLine;
import '../services/whatsapp_conversations.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'async_action_button.dart';

// The words and shared pieces of two-way WhatsApp in the app
// (docs/WHATSAPP_CONVERSATIONS.md): badges and state pills for the inbox,
// a thread's message bubbles, delivery ticks, the voice-note player and
// recorder, the conversation's packages and actions, the hand-over sheet,
// and "Message customer" on a package. The rules live in
// lib/services/whatsapp_conversations.dart.

/// WhatsApp's own green is too light for text on white; the theme's green
/// carries the badge.
const Color _whatsAppGreen = AppColors.sage;

String whatsAppRefusalText(AppLocalizations l10n, Object error) {
  final failure = error is WhatsAppActionFailure
      ? error
      : const WhatsAppActionFailure(WhatsAppRefusal.unknown);
  return switch (failure.reason) {
    WhatsAppRefusal.notThisCustomer => l10n.waRefusalNotThisCustomer,
    WhatsAppRefusal.pickAnotherInbox => l10n.waRefusalPickAnother,
    WhatsAppRefusal.businessNotFound => l10n.waRefusalBusinessNotFound,
    WhatsAppRefusal.notAllowed => l10n.waRefusalNotAllowed,
    WhatsAppRefusal.phoneRequired => l10n.waRefusalPhone,
    WhatsAppRefusal.offline => l10n.waRefusalOffline,
    WhatsAppRefusal.unknown => l10n.waRefusalUnknown,
  };
}

String whatsAppStateLabel(
  AppLocalizations l10n,
  WhatsAppConversationState state,
) {
  return switch (state) {
    WhatsAppConversationState.needsReply => l10n.waStateNeedsReply,
    WhatsAppConversationState.waitingCustomer => l10n.waStateWaiting,
    WhatsAppConversationState.choosing => l10n.waStateChoosing,
    WhatsAppConversationState.done => l10n.waStateDone,
  };
}

String whatsAppFilterLabel(AppLocalizations l10n, WhatsAppFilter filter) {
  return switch (filter) {
    WhatsAppFilter.all => l10n.waFilterAll,
    WhatsAppFilter.needsReply => l10n.waFilterNeedsReply,
    WhatsAppFilter.waitingCustomer => l10n.waFilterWaiting,
    WhatsAppFilter.done => l10n.waFilterDone,
  };
}

/// What to tell the person after a message went into a WhatsApp thread;
/// null when the tick under the message says enough.
String? whatsAppDeliveryNotice(
  AppLocalizations l10n,
  WhatsAppDelivery delivery,
) {
  return switch (delivery) {
    WhatsAppDelivery.waiting => l10n.waDeliveryWaiting,
    WhatsAppDelivery.stopped => l10n.waDeliveryStopped,
    WhatsAppDelivery.failed => l10n.waDeliveryFailed,
    WhatsAppDelivery.sent || WhatsAppDelivery.none => null,
  };
}

/// The small "WhatsApp" badge on a conversation.
class WhatsAppBadge extends StatelessWidget {
  const WhatsAppBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: _whatsAppGreen.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.chat_outlined, size: 12, color: _whatsAppGreen),
          const SizedBox(width: 4),
          Text(
            l10n.waWhatsApp,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: _whatsAppGreen,
            ),
          ),
        ],
      ),
    );
  }
}

/// A small coloured label: a conversation's state, "Stopped updates", ...
class WhatsAppPill extends StatelessWidget {
  const WhatsAppPill({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  factory WhatsAppPill.state(
    AppLocalizations l10n,
    WhatsAppConversationState state, {
    Key? key,
  }) {
    final color = switch (state) {
      WhatsAppConversationState.needsReply => AppColors.warn,
      WhatsAppConversationState.waitingCustomer ||
      WhatsAppConversationState.choosing => AppColors.cobalt,
      WhatsAppConversationState.done => AppColors.muted,
    };
    return WhatsAppPill(
      key: key,
      label: whatsAppStateLabel(l10n, state),
      color: color,
    );
  }

  factory WhatsAppPill.stopped(AppLocalizations l10n, {Key? key}) =>
      WhatsAppPill(
        key: key ?? const Key('wa-stopped-updates'),
        label: l10n.waStoppedUpdates,
        color: AppColors.errorRed,
        icon: Icons.notifications_off_outlined,
      );

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One conversation on the WhatsApp list.
class WhatsAppConversationCard extends StatelessWidget {
  const WhatsAppConversationCard({
    super.key,
    required this.supportCase,
    required this.onTap,
    this.showBusiness = false,
  });

  final SupportCase supportCase;
  final VoidCallback onTap;

  /// Laawol's list: which business holds it (or would, in launch week).
  final bool showBusiness;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = whatsAppStateOf(supportCase);
    final time = supportCase.lastMessageAt ?? supportCase.updatedAt;
    final name = supportCase.customerName.trim().isNotEmpty
        ? supportCase.customerName.trim()
        : supportCase.whatsappPhone;
    final inboxName = supportCase.businessId.isEmpty
        ? l10n.waLaawol
        : supportCase.businessName;
    final subtitle = [
      if (supportCase.whatsappPhone.isNotEmpty &&
          supportCase.whatsappPhone != name)
        supportCase.whatsappPhone,
      if (showBusiness && inboxName.isNotEmpty) inboxName,
      if (showBusiness && supportCase.suggestedBusinessName.isNotEmpty)
        l10n.waSuggestedFor(supportCase.suggestedBusinessName),
    ].join(' · ');
    final unread = supportCase.unreadCount;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      child: InkWell(
        key: ValueKey('wa-case:${supportCase.id}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                backgroundColor: _whatsAppGreen.withValues(alpha: 0.14),
                child: const Icon(Icons.chat_outlined, color: _whatsAppGreen),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
                                  fontWeight: unread > 0
                                      ? FontWeight.w800
                                      : null,
                                ),
                          ),
                        ),
                        if (time != null)
                          Text(
                            displayMonthDay(time, dateLocaleOf(context)),
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(color: AppColors.muted),
                          ),
                      ],
                    ),
                    if (subtitle.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      supportCase.lastMessage,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        const WhatsAppBadge(),
                        if (supportCase.handedTo.isNotEmpty)
                          WhatsAppPill(
                            label: l10n.waHandedOverPill,
                            color: AppColors.muted,
                            icon: Icons.forward_outlined,
                          )
                        else
                          WhatsAppPill.state(l10n, state),
                        if (supportCase.updatesStopped)
                          WhatsAppPill.stopped(l10n),
                      ],
                    ),
                  ],
                ),
              ),
              if (unread > 0) ...[
                const SizedBox(width: 8),
                Container(
                  key: const Key('wa-unread'),
                  constraints: const BoxConstraints(minWidth: 22),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: _whatsAppGreen,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    unread > 99 ? '99+' : '$unread',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The delivery tick under a message we sent, with a short word.
class WhatsAppTickLine extends StatelessWidget {
  const WhatsAppTickLine({
    super.key,
    required this.tick,
    required this.error,
    required this.color,
  });

  final WhatsAppTick tick;
  final String error;

  /// The bubble's text colour; a failure is always red.
  final Color color;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (tick == WhatsAppTick.none) return const SizedBox.shrink();
    final (IconData icon, String label, Color tint) = switch (tick) {
      WhatsAppTick.sent => (Icons.check, l10n.waTickSent, color),
      WhatsAppTick.delivered => (Icons.done_all, l10n.waTickDelivered, color),
      WhatsAppTick.read => (Icons.done_all, l10n.waTickRead, AppColors.mist),
      WhatsAppTick.failed => (
        Icons.error_outline,
        error.isEmpty ? l10n.waTickFailed : l10n.waTickFailedReason(error),
        AppColors.errorRed,
      ),
      WhatsAppTick.waiting => (Icons.schedule, l10n.waTickWaiting, color),
      WhatsAppTick.stopped => (
        Icons.notifications_off_outlined,
        l10n.waTickStopped,
        color,
      ),
      WhatsAppTick.none => (Icons.check, '', color),
    };
    final failed = tick == WhatsAppTick.failed;
    final line = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: tint),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11,
              height: 1.25,
              fontWeight: failed ? FontWeight.w800 : FontWeight.w600,
              color: tint,
            ),
          ),
        ),
      ],
    );
    if (!failed) return line;
    // Red text on a teal bubble is hard to read: a failure sits on white.
    return Container(
      margin: const EdgeInsets.only(top: 2),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
      child: line,
    );
  }
}

/// Plays a voice note in the thread. The player is made on the first tap,
/// so a thread full of voice notes opens no audio session until asked.
class WhatsAppVoicePlayer extends StatefulWidget {
  const WhatsAppVoicePlayer({
    super.key,
    required this.url,
    required this.color,
    this.durationSeconds,
  });

  final String url;
  final Color color;
  final int? durationSeconds;

  @override
  State<WhatsAppVoicePlayer> createState() => _WhatsAppVoicePlayerState();
}

class _WhatsAppVoicePlayerState extends State<WhatsAppVoicePlayer> {
  AudioPlayer? _player;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  bool _playing = false;
  bool _loading = false;
  bool _failed = false;
  Duration _position = Duration.zero;
  Duration? _duration;

  AudioPlayer _ensurePlayer() {
    final existing = _player;
    if (existing != null) return existing;
    final player = AudioPlayer();
    _subscriptions
      ..add(
        player.onPlayerStateChanged.listen((state) {
          if (!mounted) return;
          setState(() {
            _playing = state == PlayerState.playing;
            if (state == PlayerState.completed) _position = Duration.zero;
          });
        }),
      )
      ..add(
        player.onPositionChanged.listen((position) {
          if (mounted) setState(() => _position = position);
        }),
      )
      ..add(
        player.onDurationChanged.listen((duration) {
          if (mounted) setState(() => _duration = duration);
        }),
      );
    return _player = player;
  }

  Future<void> _toggle() async {
    if (_loading) return;
    final player = _ensurePlayer();
    if (_playing) {
      await player.pause();
      return;
    }
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      if (player.state == PlayerState.paused) {
        await player.resume();
      } else {
        await player
            .play(UrlSource(widget.url))
            .timeout(const Duration(seconds: 20));
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openOutside() async {
    await launchUrl(
      Uri.parse(widget.url),
      mode: LaunchMode.externalApplication,
    );
  }

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(_player?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final known = widget.durationSeconds;
    final total =
        _duration ??
        (known != null && known > 0 ? Duration(seconds: known) : null);
    final progress = total == null || total.inMilliseconds <= 0
        ? 0.0
        : (_position.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0);
    final clock = voiceNoteClock(
      _playing || _position > Duration.zero ? _position : (total ?? _position),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 220,
          child: Row(
            children: [
              IconButton(
                key: const Key('wa-voice-play'),
                onPressed: _loading ? null : _toggle,
                tooltip: _playing ? l10n.waPause : l10n.waPlay,
                icon: _loading
                    ? SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            widget.color,
                          ),
                        ),
                      )
                    : Icon(
                        _playing
                            ? Icons.pause_circle_filled
                            : Icons.play_circle_fill,
                        color: widget.color,
                        size: 30,
                      ),
              ),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: progress,
                    minHeight: 4,
                    color: widget.color,
                    backgroundColor: widget.color.withValues(alpha: 0.22),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                clock,
                style: TextStyle(
                  color: widget.color,
                  fontSize: 12,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
        if (_failed)
          // iOS cannot play every format WhatsApp sends (ogg/opus voice
          // notes): offer the file to the phone's own apps instead.
          TextButton.icon(
            onPressed: _openOutside,
            icon: const Icon(Icons.open_in_new, size: 16),
            label: Text(
              '${l10n.waAudioFailed} ${l10n.supportOpenAttachment}',
              style: TextStyle(color: widget.color, fontSize: 12),
            ),
          ),
      ],
    );
  }
}

/// A message in a WhatsApp thread. [fileTile] draws a video or document
/// (the thread's own attachment tile); [text] is what the message says,
/// already without a file's placeholder name.
class WhatsAppMessageBubble extends StatelessWidget {
  const WhatsAppMessageBubble({
    super.key,
    required this.message,
    required this.mine,
    required this.text,
    required this.fileTile,
    this.onLongPress,
  });

  final SupportMessage message;
  final bool mine;
  final String text;
  final Widget Function(Color textColor) fileTile;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final kind = whatsAppMessageKindOf(message);
    final time = message.createdAt == null
        ? ''
        : displayTime(message.createdAt!, dateLocaleOf(context));
    switch (kind) {
      case WhatsAppMessageKind.systemNote:
        return Padding(
          key: ValueKey('wa-system-note:${message.id}'),
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: AppColors.rule.withValues(alpha: 0.45),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.lock_outline,
                    size: 13,
                    color: AppColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      message.content,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      case WhatsAppMessageKind.note:
        return GestureDetector(
          key: ValueKey('wa-note:${message.id}'),
          onLongPress: onLongPress,
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.saffron.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(
                color: AppColors.saffron.withValues(alpha: 0.5),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.lock_outline,
                      size: 14,
                      color: AppColors.warn,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        l10n.waNoteBadge,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: AppColors.warn,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  message.content,
                  style: const TextStyle(fontSize: 15, height: 1.35),
                ),
                const SizedBox(height: 5),
                Text(
                  [
                    whatsAppSenderName(message),
                    time,
                  ].where((part) => part.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
        );
      case WhatsAppMessageKind.customer:
      case WhatsAppMessageKind.staff:
      case WhatsAppMessageKind.auto:
        break;
    }

    final fromCustomer = kind == WhatsAppMessageKind.customer;
    final auto = kind == WhatsAppMessageKind.auto;
    final Color bubbleColor;
    final Color textColor;
    if (fromCustomer) {
      bubbleColor = Theme.of(context).colorScheme.surface;
      textColor = Theme.of(context).colorScheme.onSurface;
    } else if (auto) {
      bubbleColor = AppColors.parchment;
      textColor = AppColors.ink;
    } else {
      bubbleColor = AppColors.cobalt;
      textColor = Colors.white;
    }
    final label = auto
        ? l10n.waAutoReply
        : (fromCustomer || !mine ? whatsAppSenderName(message) : '');
    final tick = whatsAppTickOf(message);
    return Align(
      alignment: fromCustomer ? Alignment.centerLeft : Alignment.centerRight,
      child: GestureDetector(
        key: ValueKey('wa-message:${message.id}'),
        onLongPress: onLongPress,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.8,
          ),
          margin: const EdgeInsets.symmetric(vertical: 5),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(18),
              topRight: const Radius.circular(18),
              bottomLeft: Radius.circular(fromCustomer ? 4 : 18),
              bottomRight: Radius.circular(fromCustomer ? 18 : 4),
            ),
            border: fromCustomer || auto
                ? Border.all(color: AppColors.rule)
                : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (label.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (auto) ...[
                        const Icon(
                          Icons.smart_toy_outlined,
                          size: 13,
                          color: AppColors.muted,
                        ),
                        const SizedBox(width: 4),
                      ],
                      Flexible(
                        child: Text(
                          label,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: fromCustomer
                                ? AppColors.cobalt
                                : (auto
                                      ? AppColors.muted
                                      : Colors.white.withValues(alpha: 0.85)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ..._media(context, l10n, textColor),
              if (text.isNotEmpty)
                Text(
                  text,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 15,
                    height: 1.35,
                  ),
                ),
              const SizedBox(height: 5),
              Wrap(
                spacing: 8,
                runSpacing: 2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (time.isNotEmpty)
                    Text(
                      time,
                      style: TextStyle(
                        color: textColor.withValues(alpha: 0.7),
                        fontSize: 11,
                      ),
                    ),
                  if (tick != WhatsAppTick.none)
                    WhatsAppTickLine(
                      key: ValueKey('wa-tick:${message.id}:${tick.name}'),
                      tick: tick,
                      error: message.whatsappError,
                      color: textColor.withValues(alpha: 0.78),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _media(
    BuildContext context,
    AppLocalizations l10n,
    Color textColor,
  ) {
    if (!message.isAttachment) return const [];
    if (message.mediaDeleted) {
      return [
        Padding(
          key: const Key('wa-media-deleted'),
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.hide_image_outlined,
                size: 18,
                color: textColor.withValues(alpha: 0.7),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  l10n.waMediaDeleted,
                  style: TextStyle(
                    color: textColor.withValues(alpha: 0.8),
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ],
          ),
        ),
      ];
    }
    if (message.fileUrl.isEmpty) return const [];
    final Widget media = switch (message.messageType) {
      'image' => ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: Image.network(
          message.fileUrl,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) =>
              Icon(Icons.broken_image_outlined, color: textColor),
        ),
      ),
      'voice' => WhatsAppVoicePlayer(
        url: message.fileUrl,
        color: textColor,
        durationSeconds: message.durationSeconds,
      ),
      _ => fileTile(textColor),
    };
    return [Padding(padding: const EdgeInsets.only(bottom: 6), child: media)];
  }
}

/// The customer's packages with this business, under the thread's header:
/// one line ("Packages · 2") that opens to the list, so a long conversation
/// keeps its room.
class WhatsAppPackagesCard extends StatefulWidget {
  const WhatsAppPackagesCard({
    super.key,
    required this.supportCase,
    required this.packages,
    required this.onRetry,
  });

  final SupportCase supportCase;
  final Future<List<WhatsAppPackage>>? packages;
  final VoidCallback onRetry;

  @override
  State<WhatsAppPackagesCard> createState() => _WhatsAppPackagesCardState();
}

class _WhatsAppPackagesCardState extends State<WhatsAppPackagesCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FutureBuilder<List<WhatsAppPackage>>(
      key: const Key('wa-packages'),
      future: widget.packages,
      builder: (context, snapshot) {
        final loading = snapshot.connectionState != ConnectionState.done;
        final failed = !loading && snapshot.hasError;
        final list = snapshot.data ?? const <WhatsAppPackage>[];
        final title = loading || failed
            ? l10n.waCustomerPackages
            : '${l10n.waCustomerPackages} · ${list.length}';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              key: const Key('wa-packages-toggle'),
              onTap: () => setState(() => _open = !_open),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    const Icon(
                      Icons.inventory_2_outlined,
                      size: 18,
                      color: AppColors.cobalt,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: AppColors.cobalt,
                        ),
                      ),
                    ),
                    if (loading)
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    Icon(
                      _open ? Icons.expand_less : Icons.expand_more,
                      color: AppColors.muted,
                    ),
                  ],
                ),
              ),
            ),
            if (_open)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _body(context, l10n, loading, failed, list),
              ),
          ],
        );
      },
    );
  }

  Widget _body(
    BuildContext context,
    AppLocalizations l10n,
    bool loading,
    bool failed,
    List<WhatsAppPackage> list,
  ) {
    final small = Theme.of(context).textTheme.bodySmall;
    if (loading) return Text(l10n.waPackagesLoading, style: small);
    if (failed) {
      return Row(
        children: [
          Expanded(child: Text(l10n.waPackagesFailed, style: small)),
          TextButton(onPressed: widget.onRetry, child: Text(l10n.retry)),
        ],
      );
    }
    if (list.isEmpty) {
      return Text(
        l10n.waNoPackages,
        style: small?.copyWith(color: AppColors.muted),
      );
    }
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 180),
      child: ListView(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        children: [
          for (final item in list)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                [
                  if (item.trackingCode.isNotEmpty) item.trackingCode,
                  if (item.description.isNotEmpty) item.description,
                  if (item.destination.isNotEmpty) item.destination,
                  item.customerIsReceiver
                      ? l10n.waPackageReceiver
                      : l10n.waPackageSender,
                ].join(' · '),
                style: small,
              ),
            ),
        ],
      ),
    );
  }
}

/// Done / Reopen, Private note and Hand over, at the top of the thread.
class WhatsAppThreadActions extends StatelessWidget {
  const WhatsAppThreadActions({
    super.key,
    required this.supportCase,
    required this.onDone,
    required this.onReopen,
    required this.onNote,
    required this.onHandOver,
  });

  final SupportCase supportCase;
  final Future<void> Function() onDone;
  final Future<void> Function() onReopen;
  final VoidCallback onNote;
  final VoidCallback onHandOver;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final done = whatsAppStateOf(supportCase) == WhatsAppConversationState.done;
    // Wraps rather than scrolls sideways: Hand over must never sit hidden
    // past the screen's edge (French labels are longer).
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        done
            ? AsyncActionButton.outlined(
                key: const Key('wa-reopen'),
                onPressed: onReopen,
                label: l10n.waReopen,
                loadingLabel: l10n.waReopening,
                icon: Icons.lock_open_outlined,
              )
            : AsyncActionButton.outlined(
                key: const Key('wa-done'),
                onPressed: onDone,
                label: l10n.waMarkDone,
                loadingLabel: l10n.waMarkingDone,
                icon: Icons.check_circle_outline,
              ),
        OutlinedButton.icon(
          key: const Key('wa-note'),
          onPressed: onNote,
          icon: const Icon(Icons.lock_outline, size: 18),
          label: Text(l10n.waPrivateNote),
        ),
        if (supportCase.handedTo.isEmpty)
          OutlinedButton.icon(
            key: const Key('wa-handover'),
            onPressed: onHandOver,
            icon: const Icon(Icons.forward_outlined, size: 18),
            label: Text(l10n.waHandOver),
          ),
      ],
    );
  }
}

/// A private note, written in a sheet. Pops true once saved.
class WhatsAppNoteSheet extends StatefulWidget {
  const WhatsAppNoteSheet({super.key, required this.onSave});

  final Future<void> Function(String text) onSave;

  @override
  State<WhatsAppNoteSheet> createState() => _WhatsAppNoteSheetState();
}

class _WhatsAppNoteSheetState extends State<WhatsAppNoteSheet> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() => _error = null);
    try {
      await widget.onSave(text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(
        () =>
            _error = whatsAppRefusalText(AppLocalizations.of(context)!, error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.waPrivateNote,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.lock_outline, size: 14, color: AppColors.muted),
              const SizedBox(width: 4),
              Text(
                l10n.waOnlyYourTeam,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('wa-note-field'),
            controller: _controller,
            autofocus: true,
            minLines: 3,
            maxLines: 6,
            maxLength: 2000,
            decoration: InputDecoration(labelText: l10n.waPrivateNote),
          ),
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: AppColors.errorRed)),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: AsyncActionButton.filled(
              key: const Key('wa-note-save'),
              onPressed: _save,
              label: l10n.save,
              loadingLabel: l10n.waNoteSaving,
              icon: Icons.save_outlined,
            ),
          ),
        ],
      ),
    );
  }
}

/// Where a conversation was handed: the inbox's name and the new thread.
class WhatsAppHandOverResult {
  const WhatsAppHandOverResult({required this.caseId, required this.name});

  final String caseId;
  final String name;
}

/// Hand a conversation to another inbox. Where it may go comes from the
/// server (`handoffOptions`): Laawol first, then the businesses allowed -
/// for staff, those that know this customer; for Laawol, every one.
class WhatsAppHandOverSheet extends StatefulWidget {
  const WhatsAppHandOverSheet({
    super.key,
    required this.supportCase,
    required this.service,
    required this.isAdmin,
  });

  final SupportCase supportCase;
  final WhatsAppConversationService service;
  final bool isAdmin;

  @override
  State<WhatsAppHandOverSheet> createState() => _WhatsAppHandOverSheetState();
}

class _WhatsAppHandOverSheetState extends State<WhatsAppHandOverSheet> {
  final _note = TextEditingController();
  late Future<List<WhatsAppHandOffOption>> _options = _load();
  String? _target;
  String? _error;

  Future<List<WhatsAppHandOffOption>> _load() => widget.service
      .handOffOptions(widget.supportCase.id)
      .timeout(const Duration(seconds: 20));

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String _label(AppLocalizations l10n, WhatsAppHandOffOption option) =>
      option.isLaawol ? l10n.waHandOverToLaawol : option.name;

  /// The launch-week suggestion first, else the first business, else Laawol.
  String? _defaultTarget(List<WhatsAppHandOffOption> options) {
    final suggested = widget.supportCase.suggestedBusinessId;
    if (options.any((o) => o.id == suggested)) return suggested;
    return options.isEmpty ? null : options.first.id;
  }

  Future<void> _handOver(List<WhatsAppHandOffOption> options) async {
    final l10n = AppLocalizations.of(context)!;
    final target = options
        .where((o) => o.id == (_target ?? _defaultTarget(options)))
        .firstOrNull;
    if (target == null) {
      setState(() => _error = l10n.waPickBusiness);
      return;
    }
    setState(() => _error = null);
    try {
      final caseId = await widget.service.handOff(
        widget.supportCase.id,
        target.id,
        note: _note.text,
      );
      if (!mounted) return;
      Navigator.of(
        context,
      ).pop(WhatsAppHandOverResult(caseId: caseId, name: _label(l10n, target)));
    } catch (error) {
      if (mounted) setState(() => _error = whatsAppRefusalText(l10n, error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final muted = Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(color: AppColors.muted);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: FutureBuilder<List<WhatsAppHandOffOption>>(
        future: _options,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final options = snapshot.data ?? const <WhatsAppHandOffOption>[];
          final selected = _target ?? _defaultTarget(options);
          final Widget choices;
          if (loading) {
            choices = Padding(
              key: const Key('wa-handover-loading'),
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 10),
                  Text(l10n.waHandOverLoading, style: muted),
                ],
              ),
            );
          } else if (snapshot.hasError) {
            choices = Row(
              key: const Key('wa-handover-options-error'),
              children: [
                Expanded(
                  child: Text(
                    whatsAppRefusalText(l10n, snapshot.error!),
                    style: const TextStyle(color: AppColors.errorRed),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() {
                    _options = _load();
                  }),
                  child: Text(l10n.retry),
                ),
              ],
            );
          } else if (options.isEmpty) {
            choices = Text(l10n.waHandOverNoOptions, style: muted);
          } else {
            choices = ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 280),
              child: SingleChildScrollView(
                child: RadioGroup<String>(
                  groupValue: selected,
                  onChanged: (value) => setState(() {
                    _target = value;
                    _error = null;
                  }),
                  child: Column(
                    children: [
                      for (final option in options)
                        RadioListTile<String>(
                          key: ValueKey('wa-handover-target:${option.id}'),
                          value: option.id,
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(_label(l10n, option)),
                        ),
                    ],
                  ),
                ),
              ),
            );
          }
          final onlyLaawol =
              !loading &&
              !snapshot.hasError &&
              options.every((o) => o.isLaawol);
          return SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.waHandOverTitle,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 4),
                Text(l10n.waHandOverSubtitle, style: muted),
                const SizedBox(height: 8),
                choices,
                if (onlyLaawol && !widget.isAdmin) ...[
                  const SizedBox(height: 4),
                  Text(l10n.waHandOverStaffHint, style: muted),
                ],
                const SizedBox(height: 12),
                TextField(
                  key: const Key('wa-handover-note'),
                  controller: _note,
                  maxLength: 300,
                  decoration: InputDecoration(labelText: l10n.waHandOverNote),
                ),
                if (_error != null) ...[
                  Text(
                    _error!,
                    key: const Key('wa-handover-error'),
                    style: const TextStyle(color: AppColors.errorRed),
                  ),
                  const SizedBox(height: 8),
                ],
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: AsyncActionButton.filled(
                    key: const Key('wa-handover-submit'),
                    onPressed: loading || options.isEmpty
                        ? null
                        : () => _handOver(options),
                    label: l10n.waHandOver,
                    loadingLabel: l10n.waHandingOver,
                    icon: Icons.forward_outlined,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// "Customer ✓✓ Delivered", or "Receiver ⚠ Not delivered: (reason)".
String packageUpdateTickLabel(
  AppLocalizations l10n,
  PackageUpdateTickEntry entry,
) {
  // The package screens' own words for the two people (Customer / Client,
  // Receiver / Destinataire), as on the web console.
  final who = entry.isReceiver ? l10n.ctrReceiverShort : l10n.lotCustomer;
  final mark = packageUpdateTickMark(entry.tick);
  return switch (entry.tick) {
    PackageUpdateTick.sent => l10n.waPackageTick(who, mark, l10n.waTickSent),
    PackageUpdateTick.delivered => l10n.waPackageTick(
      who,
      mark,
      l10n.waTickDelivered,
    ),
    PackageUpdateTick.read => l10n.waPackageTick(who, mark, l10n.waTickRead),
    PackageUpdateTick.failed =>
      entry.reason.isEmpty
          ? l10n.waPackageTick(who, mark, l10n.waTickFailed)
          : l10n.waPackageTickFailed(who, mark, entry.reason),
  };
}

/// A line's last update, compactly: one short line per person it went to,
/// a failure in red with its reason. Nothing when nobody has a tick.
class PackageUpdateTicks extends StatelessWidget {
  const PackageUpdateTicks({super.key, required this.line, this.indent = 0});

  final ContainerLine line;
  final double indent;

  @override
  Widget build(BuildContext context) {
    final ticks = packageUpdateTicks(line.lastCustomerUpdate);
    if (ticks.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      key: const Key('line-update-ticks'),
      padding: EdgeInsets.only(top: 4, left: indent),
      child: Wrap(
        spacing: 12,
        runSpacing: 2,
        children: [
          for (final entry in ticks)
            Text(
              packageUpdateTickLabel(l10n, entry),
              style: TextStyle(
                fontSize: 12,
                height: 1.3,
                fontWeight: FontWeight.w600,
                color: switch (entry.tick) {
                  PackageUpdateTick.failed => AppColors.errorRed,
                  PackageUpdateTick.read => AppColors.cobalt,
                  _ => AppColors.sage,
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// Records voice notes. Behind an interface so widget tests need no
/// microphone.
abstract interface class VoiceNoteRecorder {
  /// Asks for the microphone when not yet decided; false when refused.
  Future<bool> hasPermission();

  /// Starts recording to a new file; returns its path.
  Future<String> start();

  /// Stops; returns the file's path (null when nothing was recorded).
  Future<String?> stop();

  /// Stops and throws the recording away.
  Future<void> cancel();

  Future<void> dispose();
}

/// The `record` package: AAC in an .m4a ([whatsAppVoiceNoteFormat]), which
/// WhatsApp plays as a voice note.
class PackageVoiceNoteRecorder implements VoiceNoteRecorder {
  AudioRecorder? _recorder;

  AudioRecorder get _instance => _recorder ??= AudioRecorder();

  @override
  Future<bool> hasPermission() => _instance.hasPermission();

  @override
  Future<String> start() async {
    final dir = await getTemporaryDirectory();
    final path =
        '${dir.path}/${whatsAppVoiceNoteFormat.fileName(DateTime.now())}';
    await _instance.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        bitRate: 64000,
        sampleRate: 44100,
        numChannels: 1,
      ),
      path: path,
    );
    return path;
  }

  @override
  Future<String?> stop() => _instance.stop();

  @override
  Future<void> cancel() async {
    await _recorder?.cancel();
  }

  @override
  Future<void> dispose() async {
    await _recorder?.dispose();
    _recorder = null;
  }
}

/// The composer while a voice note records: discard, how long, send.
class VoiceNoteRecordingBar extends StatelessWidget {
  const VoiceNoteRecordingBar({
    super.key,
    required this.elapsed,
    required this.sending,
    required this.onCancel,
    required this.onSend,
  });

  final Duration elapsed;
  final bool sending;
  final VoidCallback onCancel;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Row(
      key: const Key('wa-recording-bar'),
      children: [
        IconButton(
          key: const Key('wa-voice-discard'),
          onPressed: sending ? null : onCancel,
          icon: const Icon(Icons.delete_outline),
          tooltip: l10n.waDiscardVoice,
        ),
        const SizedBox(width: 4),
        Container(
          width: 10,
          height: 10,
          decoration: const BoxDecoration(
            color: AppColors.errorRed,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            l10n.waRecording(voiceNoteClock(elapsed)),
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
        IconButton.filled(
          key: const Key('wa-voice-send'),
          onPressed: sending ? null : onSend,
          tooltip: l10n.waSendVoice,
          icon: sending
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                  ),
                )
              : const Icon(Icons.send),
        ),
      ],
    );
  }
}

/// "The customer last wrote over 24 hours ago": above the composer when
/// anything sent now would wait for the customer.
class WhatsAppWindowNotice extends StatelessWidget {
  const WhatsAppWindowNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('wa-window-closed'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: AppColors.saffron.withValues(alpha: 0.12),
        border: const Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 16, color: AppColors.warn),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              l10n.waWindowClosed,
              style: const TextStyle(
                fontSize: 12,
                height: 1.3,
                color: AppColors.warn,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens the WhatsApp conversation with someone on a package ("Message
/// customer"): asks whom when both the customer and the receiver have a
/// number, opens (or finds) the conversation, and shows it. Progress is a
/// blocking dialog, so the call cannot be started twice.
Future<void> openWhatsAppForLine(
  BuildContext context,
  ContainerLine line, {
  WhatsAppConversationService service = const WhatsAppConversationService(),
}) async {
  final l10n = AppLocalizations.of(context)!;
  final messenger = ScaffoldMessenger.of(context);
  final targets = messageCustomerTargets(line);
  if (targets.isEmpty) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.waNoPhone)));
    return;
  }
  WhatsAppContactTarget? target;
  if (targets.length == 1) {
    target = targets.single;
    if (!target.reachable) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.waNeedsCountryCode)));
      return;
    }
  } else {
    target = await showModalBottomSheet<WhatsAppContactTarget>(
      context: context,
      builder: (context) => _MessageWhoSheet(targets: targets),
    );
  }
  if (target == null || !context.mounted) return;
  final navigator = Navigator.of(context, rootNavigator: true);
  var dialogOpen = true;
  unawaited(
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      useRootNavigator: true,
      builder: (context) => PopScope(
        canPop: false,
        child: AlertDialog(
          key: const Key('wa-opening'),
          content: Row(
            children: [
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
              const SizedBox(width: 16),
              Expanded(child: Text(l10n.waOpening)),
            ],
          ),
        ),
      ),
    ).whenComplete(() => dialogOpen = false),
  );
  String? caseId;
  Object? failure;
  try {
    caseId = await service
        .open(phone: target.phone, name: target.name)
        .timeout(const Duration(seconds: 30));
  } catch (error) {
    failure = error is TimeoutException
        ? const WhatsAppActionFailure(WhatsAppRefusal.offline)
        : error;
  } finally {
    if (dialogOpen) navigator.pop();
  }
  if (failure != null || caseId == null) {
    messenger.showSnackBar(
      SnackBar(content: Text(whatsAppRefusalText(l10n, failure ?? 'unknown'))),
    );
    return;
  }
  await navigator.pushNamed('/support-thread', arguments: caseId);
}

class _MessageWhoSheet extends StatelessWidget {
  const _MessageWhoSheet({required this.targets});

  final List<WhatsAppContactTarget> targets;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                l10n.waMessageWho,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 8),
            for (final target in targets)
              ListTile(
                key: ValueKey('wa-message-target:${target.phone}'),
                enabled: target.reachable,
                leading: Icon(
                  target.isReceiver
                      ? Icons.call_received_outlined
                      : Icons.call_made_outlined,
                ),
                title: Text(
                  [
                    if (target.name.isNotEmpty) target.name,
                    target.isReceiver
                        ? l10n.waPackageReceiver
                        : l10n.waPackageSender,
                  ].join(' · '),
                ),
                subtitle: Text(
                  target.reachable ? target.phone : l10n.waNeedsCountryCode,
                ),
                onTap: () => Navigator.of(context).pop(target),
              ),
          ],
        ),
      ),
    );
  }
}

/// "Name customers see on WhatsApp", in the person's profile. Saved with
/// its own button through `whatsappConversation {action: setDisplayName}`.
class WhatsAppDisplayNameField extends StatefulWidget {
  const WhatsAppDisplayNameField({
    super.key,
    required this.initialName,
    required this.fullName,
    required this.businessName,
    required this.onSaved,
    this.service = const WhatsAppConversationService(),
  });

  final String initialName;
  final String fullName;

  /// How the signature ends: the business, or Laawol.
  final String businessName;
  final ValueChanged<String> onSaved;
  final WhatsAppConversationService service;

  @override
  State<WhatsAppDisplayNameField> createState() =>
      _WhatsAppDisplayNameFieldState();
}

class _WhatsAppDisplayNameFieldState extends State<WhatsAppDisplayNameField> {
  late final _controller = TextEditingController(text: widget.initialName);
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _error = null);
    try {
      final saved = await widget.service.setDisplayName(_controller.text);
      if (!mounted) return;
      _controller.text = saved;
      widget.onSaved(saved);
      messenger.showSnackBar(SnackBar(content: Text(l10n.waDisplayNameSaved)));
    } catch (error) {
      if (mounted) setState(() => _error = whatsAppRefusalText(l10n, error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: _controller,
      builder: (context, value, _) {
        final example = whatsAppSignature(
          displayName: value.text,
          fullName: widget.fullName,
          orgName: widget.businessName,
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              key: const Key('wa-display-name'),
              controller: _controller,
              maxLength: whatsAppDisplayNameMaxLength,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: l10n.waDisplayNameTitle,
                hintText: whatsAppDefaultDisplayName(widget.fullName),
                helperText: l10n.waDisplayNameHelp(example),
                helperMaxLines: 3,
                errorText: _error,
              ),
            ),
            const SizedBox(height: 8),
            AsyncActionButton.outlined(
              key: const Key('wa-display-name-save'),
              onPressed: _save,
              label: l10n.waDisplayNameSave,
              loadingLabel: l10n.saving,
              icon: Icons.badge_outlined,
            ),
          ],
        );
      },
    );
  }
}
