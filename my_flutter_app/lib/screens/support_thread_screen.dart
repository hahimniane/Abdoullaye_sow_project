import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:file_selector/file_selector.dart' show XTypeGroup, openFile;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/support_case.dart';
import '../models/support_message.dart';
import '../providers/auth_provider.dart';
import '../services/support_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/support_attachment_policy.dart';
import '../widgets/app_back_button.dart';
import '../widgets/async_action_button.dart';

typedef SupportImagePicker = Future<XFile?> Function(ImageSource source);
typedef SupportAttachmentPicker = Future<XFile?> Function();

class SupportThreadScreen extends StatefulWidget {
  const SupportThreadScreen({
    super.key,
    required this.caseId,
    this.supportRepository,
    this.userIdOverride,
    this.isAdminOverride,
    this.imagePicker,
    this.videoPicker,
    this.documentPicker,
  });

  final String caseId;
  final SupportRepository? supportRepository;
  final String? userIdOverride;
  final bool? isAdminOverride;
  final SupportImagePicker? imagePicker;
  final SupportAttachmentPicker? videoPicker;
  final SupportAttachmentPicker? documentPicker;

  @override
  State<SupportThreadScreen> createState() => _SupportThreadScreenState();
}

class _SupportThreadScreenState extends State<SupportThreadScreen> {
  late final SupportRepository _supportService;
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  SupportReplyReference? _replyingTo;
  SupportMessage? _editingMessage;
  bool _sending = false;
  bool _uploading = false;
  bool _attachmentFlowActive = false;
  int _composerRevision = 0;
  Timer? _typingTimer;
  bool _typing = false;

  @override
  void initState() {
    super.initState();
    _supportService = widget.supportRepository ?? SupportService();
    unawaited(_supportService.markRead(widget.caseId));
  }

  @override
  void dispose() {
    _typingTimer?.cancel();
    unawaited(_supportService.setTyping(widget.caseId, false));
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context)!;
    final text = _messageController.text.trim();
    if (text.isEmpty || _sending) return;
    final replyTo = _replyingTo;
    final editingMessage = _editingMessage;
    _typingTimer?.cancel();
    _typing = false;
    FocusManager.instance.primaryFocus?.unfocus();
    _messageController.clear();
    setState(() {
      _sending = true;
      _replyingTo = null;
      _editingMessage = null;
      _composerRevision += 1;
    });
    unawaited(_supportService.setTyping(widget.caseId, false));
    try {
      if (editingMessage != null) {
        await _supportService.editMessage(
          caseId: widget.caseId,
          messageId: editingMessage.id,
          content: text,
        );
      } else {
        await _supportService.sendMessage(
          caseId: widget.caseId,
          content: text,
          replyTo: replyTo,
        );
      }
    } catch (error) {
      if (!mounted) return;
      _messageController.text = text;
      setState(() {
        _replyingTo = replyTo;
        _editingMessage = editingMessage;
        _composerRevision += 1;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${l10n.supportActionFailed}: $error')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    if (_uploading || _attachmentFlowActive) return;
    await _pickAndReviewAttachment(
      picker: () {
        final override = widget.imagePicker;
        if (override != null) return override(source);
        return ImagePicker().pickImage(
          source: source,
          imageQuality: 82,
          maxWidth: 1800,
        );
      },
      messageType: 'image',
      fallbackMimeType: 'image/jpeg',
    );
  }

  Future<void> _pickVideo() async {
    if (_uploading || _attachmentFlowActive) return;
    await _pickAndReviewAttachment(
      picker: () =>
          widget.videoPicker?.call() ??
          ImagePicker().pickVideo(source: ImageSource.gallery),
      messageType: 'video',
      fallbackMimeType: 'video/mp4',
    );
  }

  Future<void> _pickDocument() async {
    final l10n = AppLocalizations.of(context)!;
    if (_uploading || _attachmentFlowActive) return;
    const documentTypes = XTypeGroup(
      label: 'documents',
      extensions: <String>['pdf', 'txt', 'doc', 'docx'],
    );
    await _pickAndReviewAttachment(
      picker: () =>
          widget.documentPicker?.call() ??
          openFile(acceptedTypeGroups: const <XTypeGroup>[documentTypes]),
      messageType: 'file',
      resolveMimeType: (file) {
        final mimeType = _documentMimeType(file.name);
        if (mimeType == null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(l10n.supportUnsupportedAttachmentType)),
          );
        }
        return mimeType;
      },
    );
  }

  Future<void> _pickAndReviewAttachment({
    required SupportAttachmentPicker picker,
    required String messageType,
    String? fallbackMimeType,
    String? Function(XFile file)? resolveMimeType,
  }) async {
    if (_attachmentFlowActive) return;
    _attachmentFlowActive = true;
    try {
      Future<_PendingSupportAttachment?> chooseAttachment() async {
        final file = await picker();
        if (file == null || !mounted) return null;
        final resolvedMimeType = resolveMimeType?.call(file);
        if (resolveMimeType != null && resolvedMimeType == null) return null;
        return _preparePickedAttachment(
          file: file,
          messageType: messageType,
          mimeType:
              resolvedMimeType ??
              file.mimeType ??
              fallbackMimeType ??
              'application/octet-stream',
        );
      }

      final attachment = await chooseAttachment();
      if (attachment == null || !mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        isDismissible: false,
        enableDrag: false,
        builder: (context) => _AttachmentReviewSheet(
          initialAttachment: attachment,
          initialCaption: _messageController.text,
          onReplace: chooseAttachment,
          onUpload: _uploadPickedAttachment,
        ),
      );
    } finally {
      _attachmentFlowActive = false;
    }
  }

  Future<_PendingSupportAttachment?> _preparePickedAttachment({
    required XFile file,
    required String messageType,
    required String mimeType,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    late final int byteLength;
    try {
      byteLength = await file.length();
    } catch (_) {
      if (!mounted) return null;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.supportFileReadFailed)));
      return null;
    }
    if (supportAttachmentExceedsLimit(
      messageType: messageType,
      byteLength: byteLength,
    )) {
      if (!mounted) return null;
      final message = switch (supportAttachmentKind(messageType)) {
        SupportAttachmentKind.image => l10n.supportImageTooLarge,
        SupportAttachmentKind.video => l10n.supportVideoTooLarge,
        SupportAttachmentKind.file => l10n.supportDocumentTooLarge,
        SupportAttachmentKind.voice => l10n.supportVoiceTooLarge,
      };
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
      return null;
    }
    Uint8List? previewBytes;
    if (supportAttachmentKind(messageType) == SupportAttachmentKind.image) {
      try {
        previewBytes = await file.readAsBytes();
      } catch (_) {
        // The file can still be uploaded by path. The review sheet explains
        // that only the local preview is unavailable.
      }
    }
    return _PendingSupportAttachment(
      file: file,
      mimeType: mimeType,
      messageType: messageType,
      byteLength: byteLength,
      previewBytes: previewBytes,
    );
  }

  Future<String?> _uploadPickedAttachment(
    _PendingSupportAttachment attachment,
    String caption,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    if (!mounted || _uploading) return l10n.supportUploadFailed;
    setState(() => _uploading = true);
    try {
      await _supportService.uploadPickedAttachment(
        caseId: widget.caseId,
        file: attachment.file,
        mimeType: attachment.mimeType,
        messageType: attachment.messageType,
        caption: caption.trim(),
      );
      _messageController.clear();
      _composerRevision += 1;
      return null;
    } catch (error) {
      if (!mounted) return l10n.supportUploadFailed;
      return _supportAttachmentUploadFailureMessage(l10n, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _showAttachmentMenu() async {
    final l10n = AppLocalizations.of(context)!;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.supportAttachmentSheetTitle,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 14),
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth < 360 ? 2 : 4;
                  return GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: columns,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 1.02,
                    children: [
                      _AttachmentActionTile(
                        icon: Icons.photo_library_outlined,
                        label: l10n.supportPhoto,
                        onTap: () => Navigator.pop(context, 'photo'),
                      ),
                      _AttachmentActionTile(
                        icon: Icons.photo_camera_outlined,
                        label: l10n.supportCamera,
                        onTap: () => Navigator.pop(context, 'camera'),
                      ),
                      _AttachmentActionTile(
                        icon: Icons.video_library_outlined,
                        label: l10n.supportVideo,
                        onTap: () => Navigator.pop(context, 'video'),
                      ),
                      _AttachmentActionTile(
                        icon: Icons.attach_file_outlined,
                        label: l10n.supportFile,
                        onTap: () => Navigator.pop(context, 'file'),
                      ),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'photo':
        await _pickImage(ImageSource.gallery);
        break;
      case 'camera':
        await _pickImage(ImageSource.camera);
        break;
      case 'video':
        await _pickVideo();
        break;
      case 'file':
        await _pickDocument();
        break;
    }
  }

  void _handleComposerChanged(String value) {
    final isTyping = value.trim().isNotEmpty;
    if (isTyping != _typing) {
      _typing = isTyping;
      unawaited(_supportService.setTyping(widget.caseId, isTyping));
    }
    _typingTimer?.cancel();
    if (isTyping) {
      _typingTimer = Timer(const Duration(seconds: 2), () {
        _typing = false;
        unawaited(_supportService.setTyping(widget.caseId, false));
      });
    }
  }

  Future<void> _showEscalationSheet(SupportCase supportCase) async {
    if (supportCase.isEscalated) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          _EscalationSheet(supportCase: supportCase, service: _supportService),
    );
  }

  Future<void> _showTextActionSheet({
    required String title,
    required String label,
    required Future<void> Function(String value) onSubmit,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          _TextActionSheet(title: title, label: label, onSubmit: onSubmit),
    );
  }

  void _showMessageActions(
    SupportMessage message,
    bool mine,
    String senderLabel,
  ) {
    final l10n = AppLocalizations.of(context)!;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply_outlined),
              title: Text(l10n.supportReply),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _replyingTo = message.toReplyReference(
                    senderNameOverride: senderLabel,
                  );
                  _editingMessage = null;
                });
              },
            ),
            if (mine && message.messageType == 'text')
              ListTile(
                leading: const Icon(Icons.edit_outlined),
                title: Text(l10n.supportEditMessage),
                onTap: () {
                  Navigator.pop(context);
                  setState(() {
                    _editingMessage = message;
                    _replyingTo = null;
                    _messageController.text = message.content;
                  });
                },
              ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: Text(l10n.supportDeleteForMe),
              onTap: () {
                Navigator.pop(context);
                unawaited(
                  _supportService.deleteMessageForMe(
                    caseId: widget.caseId,
                    messageId: message.id,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider?>();
    final uid = widget.userIdOverride ?? auth?.user?.uid ?? '';
    final isAdmin = widget.isAdminOverride ?? auth?.isAdmin ?? false;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: StreamBuilder<SupportCase?>(
          stream: _supportService.watchCase(widget.caseId),
          builder: (context, caseSnapshot) {
            final supportCase = caseSnapshot.data;
            if (supportCase == null) {
              return const Center(child: CircularProgressIndicator());
            }
            return Column(
              children: [
                _ThreadHeader(supportCase: supportCase),
                Expanded(
                  child: StreamBuilder<List<SupportMessage>>(
                    stream: _supportService.watchMessages(widget.caseId, uid),
                    builder: (context, snapshot) {
                      final messages =
                          snapshot.data ?? const <SupportMessage>[];
                      final messagesById = {
                        for (final message in messages) message.id: message,
                      };
                      final viewerRole = isAdmin
                          ? 'admin'
                          : (uid == supportCase.customerUid
                                ? 'customer'
                                : 'business');
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      return ListView.builder(
                        controller: _scrollController,
                        reverse: true,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: messages.length + 2,
                        itemBuilder: (context, index) {
                          if (index == messages.length + 1) {
                            return _SupportContextCard(
                              supportCase: supportCase,
                            );
                          }
                          if (index == messages.length) {
                            return _CaseActions(
                              supportCase: supportCase,
                              isAdmin: isAdmin,
                              canRequestEvidence: viewerRole != 'customer',
                              onResolve: () => _supportService.resolve(
                                caseId: supportCase.id,
                              ),
                              onReopen: () => _supportService.reopen(
                                caseId: supportCase.id,
                              ),
                              onEvidence: () => _showTextActionSheet(
                                title: l10n.supportRequestEvidence,
                                label: l10n.supportEvidenceNote,
                                onSubmit: (value) =>
                                    _supportService.requestEvidence(
                                      caseId: supportCase.id,
                                      note: value,
                                    ),
                              ),
                              onNote: () => _showTextActionSheet(
                                title: l10n.supportAddInternalNote,
                                label: l10n.supportNote,
                                onSubmit: (value) =>
                                    _supportService.addInternalNote(
                                      caseId: supportCase.id,
                                      note: value,
                                    ),
                              ),
                            );
                          }
                          final message = messages[index];
                          final mine = message.senderId == uid;
                          // Viewer role decides whose name is shown. Customers
                          // never see individual staff names: a business shows
                          // as the business, an admin as Laawol support.
                          final senderLabel = _senderLabel(
                            message.senderRole,
                            message.senderName,
                            viewerRole,
                            supportCase.businessName,
                            l10n,
                          );
                          return _SupportBubble(
                            message: message,
                            mine: mine,
                            senderLabel: senderLabel,
                            replySenderLabel: (replyTo) => _replySenderLabel(
                              replyTo,
                              messagesById,
                              viewerRole,
                              supportCase,
                              l10n,
                            ),
                            onLongPress: () =>
                                _showMessageActions(message, mine, senderLabel),
                          );
                        },
                      );
                    },
                  ),
                ),
                if (isAdmin)
                  _AdminNotes(caseId: widget.caseId, service: _supportService),
                _SupportEscalationBar(
                  supportCase: supportCase,
                  onEscalate: () => _showEscalationSheet(supportCase),
                ),
                _Composer(
                  controller: _messageController,
                  sending: _sending,
                  uploading: _uploading,
                  replyingTo: _replyingTo,
                  editingMessage: _editingMessage,
                  revision: _composerRevision,
                  onSend: _send,
                  onAttach: _showAttachmentMenu,
                  onChanged: _handleComposerChanged,
                  onCancelReply: () => setState(() {
                    _replyingTo = null;
                    _editingMessage = null;
                    _messageController.clear();
                  }),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

String? _documentMimeType(String fileName) {
  final extension = fileName.split('.').last.toLowerCase();
  return switch (extension) {
    'pdf' => 'application/pdf',
    'txt' => 'text/plain',
    'doc' => 'application/msword',
    'docx' =>
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    _ => null,
  };
}

String _supportAttachmentUploadFailureMessage(
  AppLocalizations l10n,
  Object error,
) {
  final code = _firebaseErrorCode(error);
  final message = _firebaseErrorMessage(error).toLowerCase();
  final searchable = '$code $message';

  if (searchable.contains('app check') ||
      searchable.contains('app-check') ||
      searchable.contains('appcheck')) {
    return kDebugMode
        ? l10n.supportUploadFailedDebugAppCheck
        : l10n.supportUploadFailedAppVerification;
  }

  return switch (code) {
    'network-request-failed' ||
    'unavailable' ||
    'deadline-exceeded' ||
    'retry-limit-exceeded' => l10n.supportUploadFailedNetwork,
    'unauthenticated' => l10n.supportUploadFailedAuth,
    'permission-denied' || 'unauthorized' => l10n.supportUploadFailedPermission,
    'invalid-argument' => l10n.supportUploadFailedInvalidFile,
    _ when message.contains('sign in required') => l10n.supportUploadFailedAuth,
    _ => l10n.supportUploadFailed,
  };
}

String _firebaseErrorCode(Object error) {
  return switch (error) {
    FirebaseFunctionsException(:final code) => code.toLowerCase(),
    FirebaseException(:final code) => code.toLowerCase(),
    _ => '',
  };
}

String _firebaseErrorMessage(Object error) {
  return switch (error) {
    FirebaseFunctionsException(:final message, :final details) =>
      '${message ?? ''} ${details ?? ''}',
    FirebaseException(:final message, :final plugin) =>
      '${message ?? ''} $plugin',
    _ => error.toString(),
  };
}

class _PendingSupportAttachment {
  const _PendingSupportAttachment({
    required this.file,
    required this.mimeType,
    required this.messageType,
    required this.byteLength,
    this.previewBytes,
  });

  final XFile file;
  final String mimeType;
  final String messageType;
  final int byteLength;
  final Uint8List? previewBytes;
}

class _AttachmentReviewSheet extends StatefulWidget {
  const _AttachmentReviewSheet({
    required this.initialAttachment,
    required this.initialCaption,
    required this.onReplace,
    required this.onUpload,
  });

  final _PendingSupportAttachment initialAttachment;
  final String initialCaption;
  final Future<_PendingSupportAttachment?> Function() onReplace;
  final Future<String?> Function(
    _PendingSupportAttachment attachment,
    String caption,
  )
  onUpload;

  @override
  State<_AttachmentReviewSheet> createState() => _AttachmentReviewSheetState();
}

class _AttachmentReviewSheetState extends State<_AttachmentReviewSheet> {
  late _PendingSupportAttachment _attachment;
  late final TextEditingController _captionController;
  bool _replacing = false;
  bool _uploading = false;
  String? _uploadError;

  @override
  void initState() {
    super.initState();
    _attachment = widget.initialAttachment;
    _captionController = TextEditingController(text: widget.initialCaption);
  }

  @override
  void dispose() {
    _captionController.dispose();
    super.dispose();
  }

  Future<void> _replace() async {
    if (_replacing || _uploading) return;
    setState(() {
      _replacing = true;
      _uploadError = null;
    });
    try {
      final replacement = await widget.onReplace();
      if (mounted && replacement != null) {
        setState(() => _attachment = replacement);
      }
    } finally {
      if (mounted) setState(() => _replacing = false);
    }
  }

  Future<void> _upload() async {
    if (_uploading || _replacing) return;
    setState(() {
      _uploading = true;
      _uploadError = null;
    });
    final uploadError = await widget.onUpload(
      _attachment,
      _captionController.text,
    );
    if (!mounted) return;
    if (uploadError == null) {
      Navigator.pop(context);
      return;
    }
    setState(() {
      _uploading = false;
      _uploadError = uploadError;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final busy = _uploading || _replacing;
    return PopScope(
      canPop: !busy,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.md,
            AppSpacing.lg,
            MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * 0.86,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.supportReviewAttachmentTitle,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: busy ? null : () => Navigator.pop(context),
                      tooltip: MaterialLocalizations.of(
                        context,
                      ).closeButtonTooltip,
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _AttachmentPreview(attachment: _attachment),
                        const SizedBox(height: AppSpacing.md),
                        TextField(
                          controller: _captionController,
                          enabled: !busy,
                          minLines: 1,
                          maxLines: 3,
                          decoration: InputDecoration(
                            labelText: l10n.supportAttachmentCaption,
                          ),
                        ),
                        if (_uploadError != null) ...[
                          const SizedBox(height: AppSpacing.md),
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              _uploadError!,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: busy ? null : () => Navigator.pop(context),
                        child: Text(l10n.cancel),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: busy ? null : _replace,
                        icon: _replacing
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.swap_horiz),
                        label: Text(l10n.supportReplaceAttachment),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                SizedBox(
                  width: double.infinity,
                  child: AsyncActionButton.filled(
                    onPressed: busy ? null : _upload,
                    label: _uploadError != null
                        ? l10n.retry
                        : l10n.supportUploadAttachment,
                    loadingLabel: l10n.supportUploading,
                    icon: Icons.cloud_upload_outlined,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AttachmentPreview extends StatelessWidget {
  const _AttachmentPreview({required this.attachment});

  final _PendingSupportAttachment attachment;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final kind = supportAttachmentKind(attachment.messageType);
    final previewBytes = attachment.previewBytes;
    final preview = switch (kind) {
      SupportAttachmentKind.image when previewBytes != null => Semantics(
        image: true,
        label: l10n.supportImagePreviewLabel(attachment.file.name),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          child: Container(
            constraints: const BoxConstraints(maxHeight: 320),
            width: double.infinity,
            color: AppColors.mist.withValues(alpha: 0.36),
            child: Image.memory(
              previewBytes,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) =>
                  const _PreviewUnavailable(),
            ),
          ),
        ),
      ),
      SupportAttachmentKind.image => const _PreviewUnavailable(),
      SupportAttachmentKind.video => _AttachmentTypePlaceholder(
        icon: Icons.video_file_outlined,
        label: l10n.supportVideoAttachment,
      ),
      SupportAttachmentKind.file => _AttachmentTypePlaceholder(
        icon: Icons.insert_drive_file_outlined,
        label: l10n.supportFileAttachment,
      ),
      SupportAttachmentKind.voice => _AttachmentTypePlaceholder(
        icon: Icons.audio_file_outlined,
        label: l10n.supportVoiceAttachment,
      ),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        preview,
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.rule),
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          child: Row(
            children: [
              Icon(switch (kind) {
                SupportAttachmentKind.image => Icons.image_outlined,
                SupportAttachmentKind.video => Icons.video_file_outlined,
                SupportAttachmentKind.file => Icons.insert_drive_file_outlined,
                SupportAttachmentKind.voice => Icons.audio_file_outlined,
              }, color: AppColors.cobalt),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      attachment.file.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      l10n.supportAttachmentSize(
                        _formatAttachmentBytes(attachment.byteLength),
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AttachmentTypePlaceholder extends StatelessWidget {
  const _AttachmentTypePlaceholder({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 128),
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.36),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 36, color: AppColors.cobalt),
          const SizedBox(height: AppSpacing.sm),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _PreviewUnavailable extends StatelessWidget {
  const _PreviewUnavailable();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      constraints: const BoxConstraints(minHeight: 128),
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.36),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.preview_outlined, size: 36, color: AppColors.muted),
          const SizedBox(height: AppSpacing.sm),
          Text(l10n.supportPreviewUnavailable, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

String _formatAttachmentBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

class _AttachmentActionTile extends StatelessWidget {
  const _AttachmentActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Ink(
        decoration: BoxDecoration(
          color: AppColors.mist.withValues(alpha: 0.36),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.rule),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: AppColors.cobalt),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThreadHeader extends StatelessWidget {
  const _ThreadHeader({required this.supportCase});

  final SupportCase supportCase;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 16, 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: const Border(bottom: BorderSide(color: AppColors.rule)),
      ),
      child: Row(
        children: [
          const AppBackButton(),
          const SizedBox(width: 10),
          CircleAvatar(
            backgroundColor: supportCase.isEscalated
                ? AppColors.saffron
                : AppColors.cobalt,
            child: Icon(
              supportCase.isEscalated
                  ? Icons.admin_panel_settings_outlined
                  : Icons.support_agent_outlined,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  supportCase.subject.isEmpty
                      ? l10n.supportChat
                      : supportCase.subject,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(
                  supportCase.isEscalated
                      ? l10n.supportPlatformAdmin
                      : supportCase.businessName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SupportContextCard extends StatelessWidget {
  const _SupportContextCard({required this.supportCase});

  final SupportCase supportCase;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.supportLinkedRecord,
            style: Theme.of(
              context,
            ).textTheme.labelLarge?.copyWith(color: AppColors.cobalt),
          ),
          const SizedBox(height: 6),
          Text(
            supportCase.relatedLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '${supportCase.businessName} · ${supportCase.customerName}',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class _CaseActions extends StatelessWidget {
  const _CaseActions({
    required this.supportCase,
    required this.isAdmin,
    required this.canRequestEvidence,
    required this.onResolve,
    required this.onReopen,
    required this.onEvidence,
    required this.onNote,
  });

  final SupportCase supportCase;
  final bool isAdmin;
  final bool canRequestEvidence;
  final Future<void> Function() onResolve;
  final Future<void> Function() onReopen;
  final VoidCallback onEvidence;
  final VoidCallback onNote;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          ActionChip(
            avatar: Icon(
              supportCase.isResolved
                  ? Icons.lock_open_outlined
                  : Icons.check_circle_outline,
              size: 18,
            ),
            label: Text(
              supportCase.isResolved ? l10n.supportReopen : l10n.supportResolve,
            ),
            onPressed: () =>
                unawaited(supportCase.isResolved ? onReopen() : onResolve()),
          ),
          if (canRequestEvidence)
            ActionChip(
              avatar: const Icon(Icons.upload_file_outlined, size: 18),
              label: Text(l10n.supportRequestEvidence),
              onPressed: onEvidence,
            ),
          if (isAdmin)
            ActionChip(
              avatar: const Icon(Icons.note_alt_outlined, size: 18),
              label: Text(l10n.supportAddInternalNote),
              onPressed: onNote,
            ),
        ],
      ),
    );
  }
}

class _SupportEscalationBar extends StatelessWidget {
  const _SupportEscalationBar({
    required this.supportCase,
    required this.onEscalate,
  });

  final SupportCase supportCase;
  final VoidCallback onEscalate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final escalated = supportCase.isEscalated;
    final color = escalated ? AppColors.saffron : AppColors.cobalt;
    final title = escalated
        ? l10n.supportAlreadyEscalatedTitle
        : l10n.supportPlatformAdmin;
    final subtitle = escalated
        ? l10n.supportAlreadyEscalatedSubtitle
        : (supportCase.escalationAvailable
              ? l10n.supportEscalationSubtitle
              : l10n.supportEscalationUrgentOnly);
    final summary = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          escalated
              ? Icons.admin_panel_settings_outlined
              : Icons.support_agent_outlined,
          color: color,
          size: 22,
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
              ),
            ],
          ),
        ),
      ],
    );

    final action = OutlinedButton.icon(
      onPressed: onEscalate,
      icon: const Icon(Icons.admin_panel_settings_outlined, size: 18),
      label: Text(
        l10n.supportAskPlatform,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: escalated
            ? AppColors.saffron.withValues(alpha: 0.10)
            : Theme.of(context).colorScheme.surface,
        border: const Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: SafeArea(
        top: false,
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.md,
            AppSpacing.lg,
            AppSpacing.sm,
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              if (escalated) return summary;
              if (constraints.maxWidth < 430) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    summary,
                    const SizedBox(height: AppSpacing.sm),
                    SizedBox(width: double.infinity, child: action),
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(child: summary),
                  const SizedBox(width: AppSpacing.md),
                  Flexible(child: action),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

// Resolve the name shown on a message for the current viewer. Customers must
// not see individual staff identities: a business message shows as the business
// name, an admin message as "Laawol support". Staff/admins keep real names.
String _senderLabel(
  String senderRole,
  String senderName,
  String viewerRole,
  String businessName,
  AppLocalizations l10n,
) {
  if (senderRole == 'admin') {
    return viewerRole == 'admin' ? senderName : l10n.supportPlatformSenderName;
  }
  if (senderRole == 'business') {
    if (viewerRole == 'customer') {
      return businessName.isNotEmpty
          ? businessName
          : l10n.supportBusinessSenderName;
    }
    return senderName;
  }
  return senderName;
}

String _replySenderLabel(
  SupportReplyReference replyTo,
  Map<String, SupportMessage> messagesById,
  String viewerRole,
  SupportCase supportCase,
  AppLocalizations l10n,
) {
  final originalMessage = messagesById[replyTo.messageId];
  if (originalMessage != null) {
    return _senderLabel(
      originalMessage.senderRole,
      originalMessage.senderName,
      viewerRole,
      supportCase.businessName,
      l10n,
    );
  }

  final storedName = replyTo.senderName.trim();
  if (viewerRole != 'customer') {
    return storedName.isEmpty ? l10n.unknown : storedName;
  }
  if (_samePersonLabel(storedName, supportCase.customerName)) {
    return storedName;
  }
  if (supportCase.isEscalated) {
    return l10n.supportPlatformSenderName;
  }
  return supportCase.businessName.isNotEmpty
      ? supportCase.businessName
      : l10n.supportBusinessSenderName;
}

bool _samePersonLabel(String a, String b) {
  final first = a.trim().toLowerCase();
  final second = b.trim().toLowerCase();
  if (first.isEmpty || second.isEmpty) return false;
  return first == second ||
      first == second.split(RegExp(r'\s+')).first ||
      second == first.split(RegExp(r'\s+')).first;
}

class _SupportBubble extends StatelessWidget {
  const _SupportBubble({
    required this.message,
    required this.mine,
    required this.senderLabel,
    required this.replySenderLabel,
    required this.onLongPress,
  });

  final SupportMessage message;
  final String senderLabel;
  final String Function(SupportReplyReference replyTo) replySenderLabel;
  final bool mine;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (message.isSystem) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: AppColors.rule.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              message.content,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ),
      );
    }
    final bubbleColor = mine
        ? AppColors.cobalt
        : Theme.of(context).colorScheme.surface;
    final textColor = mine
        ? Colors.white
        : Theme.of(context).colorScheme.onSurface;
    final displayText = _supportMessageDisplayText(message);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78,
          ),
          margin: const EdgeInsets.symmetric(vertical: 5),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(18),
              topRight: const Radius.circular(18),
              bottomLeft: Radius.circular(mine ? 18 : 4),
              bottomRight: Radius.circular(mine ? 4 : 18),
            ),
            border: mine ? null : Border.all(color: AppColors.rule),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mine)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    senderLabel,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.cobalt,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              if (message.replyTo != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: (mine ? Colors.white : AppColors.cobalt).withValues(
                      alpha: 0.14,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${replySenderLabel(message.replyTo!)}: ${message.replyTo!.content}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: textColor.withValues(alpha: 0.8)),
                  ),
                ),
              if (message.messageType == 'image' && message.fileUrl.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(message.fileUrl, fit: BoxFit.cover),
                ),
              if ((message.messageType == 'file' ||
                      message.messageType == 'voice' ||
                      message.messageType == 'video') &&
                  message.fileUrl.isNotEmpty)
                _AttachmentOpenTile(
                  message: message,
                  mine: mine,
                  textColor: textColor,
                ),
              if (message.messageType != 'file' &&
                  message.messageType != 'voice' &&
                  message.messageType != 'video' &&
                  displayText.isNotEmpty)
                Text(
                  displayText,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 15,
                    height: 1.35,
                  ),
                ),
              const SizedBox(height: 5),
              Text(
                [
                  if (message.createdAt != null)
                    DateFormat.jm().format(message.createdAt!),
                  if (message.isEdited) l10n.supportEdited,
                ].join(' · '),
                style: TextStyle(
                  color: textColor.withValues(alpha: 0.7),
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _supportMessageDisplayText(SupportMessage message) {
  if (!message.isAttachment) return message.content;

  final caption = message.caption;
  if (caption.isNotEmpty) return caption;

  final content = message.content.trim();
  if (content.isEmpty || content == message.messageType) return '';

  final fileName = message.fileName;
  if (fileName.isNotEmpty && content == fileName) return '';

  return content;
}

class _AttachmentOpenTile extends StatefulWidget {
  const _AttachmentOpenTile({
    required this.message,
    required this.mine,
    required this.textColor,
  });

  final SupportMessage message;
  final bool mine;
  final Color textColor;

  @override
  State<_AttachmentOpenTile> createState() => _AttachmentOpenTileState();
}

class _AttachmentOpenTileState extends State<_AttachmentOpenTile> {
  bool _opening = false;

  Future<void> _open() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      await launchUrl(
        Uri.parse(widget.message.fileUrl),
        mode: LaunchMode.externalApplication,
      );
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isVoice = widget.message.messageType == 'voice';
    final isVideo = widget.message.messageType == 'video';
    final label = widget.message.fileName.isEmpty
        ? (isVoice
              ? l10n.supportVoiceAttachment
              : (isVideo
                    ? l10n.supportVideoAttachment
                    : l10n.supportFileAttachment))
        : widget.message.fileName;
    final meta = isVoice
        ? _formatDuration(l10n, widget.message.durationSeconds)
        : _formatFileSize(l10n, widget.message.fileSize);
    return InkWell(
      onTap: _opening ? null : _open,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        constraints: const BoxConstraints(minWidth: 220),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: (widget.mine ? Colors.white : AppColors.cobalt).withValues(
            alpha: 0.14,
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _opening
                ? SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        widget.textColor,
                      ),
                    ),
                  )
                : Icon(
                    isVoice || isVideo
                        ? Icons.play_arrow_outlined
                        : Icons.insert_drive_file_outlined,
                    color: widget.textColor,
                  ),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: widget.textColor,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: widget.textColor.withValues(alpha: 0.72),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatDuration(AppLocalizations l10n, int? seconds) {
    if (seconds == null || seconds <= 0) return l10n.supportOpenAttachment;
    final duration = Duration(seconds: seconds);
    final value =
        '${duration.inMinutes}:${duration.inSeconds.remainder(60).toString().padLeft(2, '0')}';
    return l10n.supportVoiceDuration(value);
  }

  String _formatFileSize(AppLocalizations l10n, int? bytes) {
    if (bytes == null || bytes <= 0) return l10n.supportOpenAttachment;
    if (bytes < 1024 * 1024) {
      return l10n.supportAttachmentSize('${(bytes / 1024).round()} KB');
    }
    return l10n.supportAttachmentSize(
      '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB',
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.sending,
    required this.uploading,
    required this.replyingTo,
    required this.editingMessage,
    required this.revision,
    required this.onSend,
    required this.onAttach,
    required this.onChanged,
    required this.onCancelReply,
  });

  final TextEditingController controller;
  final bool sending;
  final bool uploading;
  final SupportReplyReference? replyingTo;
  final SupportMessage? editingMessage;
  final int revision;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final ValueChanged<String> onChanged;
  final VoidCallback onCancelReply;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: EdgeInsets.fromLTRB(
        12,
        10,
        12,
        MediaQuery.of(context).padding.bottom + 10,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: const Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (replyingTo != null || editingMessage != null)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.mist.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      editingMessage != null
                          ? l10n.supportEditMessage
                          : l10n.supportReplyingTo(replyingTo!.senderName),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    onPressed: onCancelReply,
                    icon: const Icon(Icons.close),
                    tooltip: l10n.supportCancelReply,
                  ),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton.filledTonal(
                onPressed: uploading ? null : onAttach,
                icon: uploading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add),
                tooltip: l10n.supportAddAttachment,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  key: ValueKey<int>(revision),
                  controller: controller,
                  minLines: 1,
                  maxLines: 5,
                  onChanged: onChanged,
                  decoration: InputDecoration(
                    hintText: l10n.writeSupportMessage,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: sending ? null : onSend,
                icon: sending
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            Colors.white,
                          ),
                        ),
                      )
                    : Icon(editingMessage == null ? Icons.send : Icons.check),
                tooltip: l10n.sendMessage,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EscalationSheet extends StatefulWidget {
  const _EscalationSheet({required this.supportCase, required this.service});

  final SupportCase supportCase;
  final SupportRepository service;

  @override
  State<_EscalationSheet> createState() => _EscalationSheetState();
}

class _EscalationSheetState extends State<_EscalationSheet> {
  final TextEditingController _noteController = TextEditingController();
  late String _reason;

  @override
  void initState() {
    super.initState();
    _reason = widget.supportCase.escalationAvailable
        ? 'unresolved'
        : 'business_unreachable';
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final reasons = <String, String>{
      if (widget.supportCase.escalationAvailable)
        'unresolved': l10n.supportReasonUnresolved,
      'fraud': l10n.supportReasonFraud,
      'safety': l10n.supportReasonSafety,
      'abuse': l10n.supportReasonAbuse,
      'payment_no_service': l10n.supportReasonPaymentNoService,
      'business_unreachable': l10n.supportReasonBusinessUnreachable,
      'pickup_delivery_time_sensitive': l10n.supportReasonTimeSensitive,
    };
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
            l10n.supportEscalationTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 6),
          Text(l10n.supportEscalationSubtitle),
          if (!widget.supportCase.escalationAvailable) ...[
            const SizedBox(height: 8),
            Text(
              l10n.supportEscalationUrgentOnly,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: AppColors.warn),
            ),
          ],
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _reason,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: l10n.supportEscalationReason,
            ),
            items: reasons.entries
                .map(
                  (entry) => DropdownMenuItem(
                    value: entry.key,
                    child: Text(entry.value),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) setState(() => _reason = value);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _noteController,
            minLines: 3,
            maxLines: 5,
            decoration: InputDecoration(labelText: l10n.supportEscalationNote),
          ),
          const SizedBox(height: 16),
          AsyncActionButton.filled(
            onPressed: () async {
              await widget.service.escalate(
                caseId: widget.supportCase.id,
                reason: _reason,
                note: _noteController.text,
              );
              if (context.mounted) Navigator.pop(context);
            },
            label: l10n.supportAskPlatform,
            loadingLabel: l10n.supportEscalating,
            icon: Icons.admin_panel_settings_outlined,
          ),
        ],
      ),
    );
  }
}

class _TextActionSheet extends StatefulWidget {
  const _TextActionSheet({
    required this.title,
    required this.label,
    required this.onSubmit,
  });

  final String title;
  final String label;
  final Future<void> Function(String value) onSubmit;

  @override
  State<_TextActionSheet> createState() => _TextActionSheetState();
}

class _TextActionSheetState extends State<_TextActionSheet> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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
          Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(labelText: widget.label),
          ),
          const SizedBox(height: 16),
          AsyncActionButton.filled(
            onPressed: () async {
              await widget.onSubmit(_controller.text.trim());
              if (context.mounted) Navigator.pop(context);
            },
            label: l10n.save,
            loadingLabel: l10n.supportSavingNote,
            icon: Icons.save_outlined,
          ),
        ],
      ),
    );
  }
}

class _AdminNotes extends StatelessWidget {
  const _AdminNotes({required this.caseId, required this.service});

  final String caseId;
  final SupportRepository service;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 16),
      title: Text(l10n.supportInternalNotes),
      children: [
        StreamBuilder<List<Map<String, dynamic>>>(
          stream: service.watchInternalNotes(caseId),
          builder: (context, snapshot) {
            final notes = snapshot.data ?? const <Map<String, dynamic>>[];
            return Column(
              children: [
                for (final note in notes.take(5))
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.lock_outline),
                    title: Text((note['note'] ?? '').toString()),
                    subtitle: Text((note['actorName'] ?? '').toString()),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}
