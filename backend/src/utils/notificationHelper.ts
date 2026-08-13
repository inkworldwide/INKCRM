import mongoose from 'mongoose';
import Notification from '../models/Notification';
import User from '../models/User';

interface CreateNotificationParams {
  organizationId: any;
  recipient: string | mongoose.Types.ObjectId; // User ID, email, or Full Name
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  link?: string;
}

/**
 * Creates a notification for a recipient identified by User ID, Email, or Full Name.
 */
export const createNotification = async ({
  organizationId,
  recipient,
  title,
  message,
  type = 'info',
  link
}: CreateNotificationParams) => {
  try {
    if (!recipient || !organizationId) return null;

    let targetUserId: mongoose.Types.ObjectId | null = null;

    if (mongoose.Types.ObjectId.isValid(String(recipient))) {
      const existingUser = await User.findOne({
        _id: recipient,
        organizationId
      });
      if (existingUser) {
        targetUserId = existingUser._id as mongoose.Types.ObjectId;
      }
    }

    if (!targetUserId) {
      // Look up user by full name or email
      const searchStr = String(recipient).trim().toLowerCase();
      const parts = searchStr.split(/\s+/);

      const user = await User.findOne({
        organizationId,
        $or: [
          { email: searchStr },
          { firstName: new RegExp(`^${searchStr}$`, 'i') },
          { lastName: new RegExp(`^${searchStr}$`, 'i') },
          {
            $expr: {
              $eq: [
                { $toLower: { $concat: ['$firstName', ' ', '$lastName'] } },
                searchStr
              ]
            }
          },
          ...(parts.length > 1
            ? [
                {
                  $and: [
                    { firstName: new RegExp(`^${parts[0]}$`, 'i') },
                    { lastName: new RegExp(`^${parts.slice(1).join(' ')}$`, 'i') }
                  ]
                }
              ]
            : [])
        ]
      });

      if (user) {
        targetUserId = user._id as mongoose.Types.ObjectId;
      }
    }

    if (!targetUserId) {
      return null;
    }

    const notification = await Notification.create({
      organizationId,
      userId: targetUserId,
      title,
      message,
      type,
      isRead: false,
      link
    });

    return notification;
  } catch (error) {
    console.error('Failed to create notification:', error);
    return null;
  }
};
