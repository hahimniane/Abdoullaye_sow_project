import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import 'add_staff_screen.dart';
import '../l10n/app_localizations.dart';

class UserManagementScreen extends StatefulWidget {
  const UserManagementScreen({super.key});

  @override
  State<UserManagementScreen> createState() => _UserManagementScreenState();
}

class _UserManagementScreenState extends State<UserManagementScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  Future<void> _updateUserRole(String userId, String role) async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    try {
      await authProvider.updateUserRole(userId, role);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.userRoleUpdated(role),
            ),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(
                context,
              )!.failedToUpdateUserRole(e.toString()),
            ),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _deleteUser(String userId, String userEmail) async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final localizations = AppLocalizations.of(context)!;

    // Show a confirmation dialog before deleting
    final bool confirm = await showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text(localizations.confirmDeletion),
          content: Text(localizations.confirmDeleteUser(userEmail)),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(localizations.cancel),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(
                localizations.delete,
                style: const TextStyle(color: Colors.red),
              ),
            ),
          ],
        );
      },
    ) ?? false;

    if (confirm) {
      try {
        await authProvider.deleteUser(userId);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(localizations.userDeleted(userEmail)),
              backgroundColor: Colors.green,
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(localizations.failedToDeleteUser(e.toString())),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF667eea), Color(0xFF764ba2)],
        ),
      ),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(
            AppLocalizations.of(context)!.userManagement,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          backgroundColor: Colors.transparent,
          elevation: 0,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        body: StreamBuilder<QuerySnapshot>(
          stream: _firestore.collection('users').snapshots(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(
                child: CircularProgressIndicator(color: Colors.white),
              );
            }

            if (snapshot.hasError) {
              return Center(
                child: Text(
                  'Error: ${snapshot.error}',
                  style: const TextStyle(color: Colors.white),
                ),
              );
            }

            if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
              return Center(
                child: Text(
                  AppLocalizations.of(context)!.noUsersFound,
                  style: const TextStyle(color: Colors.white),
                ),
              );
            }

            final users = snapshot.data!.docs;

            return ListView.builder(
              padding: const EdgeInsets.only(top: 16),
              itemCount: users.length,
              itemBuilder: (context, index) {
                final user = users[index];
                final userData = user.data() as Map<String, dynamic>;
                final userRole = userData['role'] ?? 'customer';
                final userEmail = userData['email'] ?? 'No email';

                return Card(
                  margin: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  color: Colors.white.withOpacity(0.15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  elevation: 0,
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: Colors.white.withOpacity(0.9),
                      child: Text(
                        userData['email']?.substring(0, 1).toUpperCase() ?? 'U',
                        style: const TextStyle(
                          color: Color(0xFF667eea),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    title: Text(
                      userData['email'] ?? 'No email',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    subtitle: Text(
                      '${AppLocalizations.of(context)!.role}: $userRole',
                      style: TextStyle(color: Colors.white.withOpacity(0.8)),
                    ),
                    trailing: PopupMenuButton<String>(
                      onSelected: (String value) {
                        if (value == 'delete') {
                          _deleteUser(user.id, userEmail);
                        } else {
                          _updateUserRole(user.id, value);
                        }
                      },
                      itemBuilder:
                          (BuildContext context) => <PopupMenuEntry<String>>[
                            PopupMenuItem<String>(
                              value: 'customer',
                              child: Text(
                                AppLocalizations.of(context)!.setAsCustomer,
                              ),
                            ),
                            PopupMenuItem<String>(
                              value: 'staff',
                              child: Text(
                                AppLocalizations.of(context)!.setAsStaff,
                              ),
                            ),
                            PopupMenuItem<String>(
                              value: 'admin',
                              child: Text(
                                AppLocalizations.of(context)!.setAsAdmin,
                              ),
                            ),
                            const PopupMenuDivider(),
                            PopupMenuItem<String>(
                              value: 'delete',
                              child: Text(
                                AppLocalizations.of(context)!.deleteUser,
                                style: const TextStyle(color: Colors.red),
                              ),
                            ),
                          ],
                      icon: const Icon(Icons.more_vert, color: Colors.white),
                    ),
                  ),
                );
              },
            );
          },
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const AddStaffScreen()),
            );
          },
          backgroundColor: Colors.white,
          child: const Icon(Icons.add, color: Color(0xFF667eea)),
        ),
      ),
    );
  }
}
