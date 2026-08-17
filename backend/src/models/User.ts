import mongoose, { Schema, Document } from 'mongoose';

export interface IDeviceSession {
  deviceId: string;
  browser: string;
  os: string;
  ip: string;
  lastActive: Date;
}

export interface IRegisteredLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  capturedAt?: Date;
}

export interface ICurrentLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  lastUpdated?: Date;
}

export interface ILoginHistoryEntry {
  loginAt: Date;
  ip?: string;
  browser?: string;
  os?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  locationVerificationSkipped?: boolean;
}

export interface IUser extends Document {
  organizationId: mongoose.Types.ObjectId;
  roleId: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  plainPassword?: string;
  isVerified: boolean;
  twoFactor: {
    enabled: boolean;
    secret?: string;
    tempToken?: string;
  };
  faceRecognition: {
    enabled: boolean;
    encryptedEmbedding?: string;
    enrolledAt?: Date;
  };
  registrationLocation?: IRegisteredLocation;
  registeredLocation?: IRegisteredLocation;
  currentLocation?: ICurrentLocation;
  locationVerificationSkipped?: boolean;
  loginHistory?: ILoginHistoryEntry[];
  locationRadius: number; // allowed radius in meters (default: 100)
  avatarUrl?: string;
  refreshTokens: string[];
  activeDevices: IDeviceSession[];
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date;
  userCode?: string; // Captured unique partner/user code (e.g. PTR--20260709080516)
  skipFace: boolean; // Bypass biometric face recognition check
  skipLocation: boolean; // Bypass proximity location check
  isActive: boolean; // Account status: enabled (true) or disabled (false)
  isApproved?: boolean; // Super Admin approval state
  approvalStatus?: 'pending' | 'approved' | 'rejected'; // Detailed approval state
  reportingManager?: mongoose.Types.ObjectId; // Reference to another User who is their manager
  department?: string; // Associated department name
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    plainPassword: { type: String },
    isVerified: { type: Boolean, default: false },
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String },
      tempToken: { type: String }
    },
    faceRecognition: {
      enabled: { type: Boolean, default: false },
      encryptedEmbedding: { type: String },
      enrolledAt: { type: Date }
    },
    // GPS registration location — stored once at signup / onboarding
    registeredLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
      capturedAt: { type: Date }
    },
    registrationLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
      capturedAt: { type: Date }
    },
    // Dynamic current location — updated on login when location verification is skipped
    currentLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
      lastUpdated: { type: Date }
    },
    locationVerificationSkipped: { type: Boolean, default: false },
    // Complete audit log of past logins with date, time, IP, browser, and GPS address
    loginHistory: [
      {
        loginAt: { type: Date, default: Date.now },
        ip: { type: String },
        browser: { type: String },
        os: { type: String },
        latitude: { type: Number },
        longitude: { type: Number },
        address: { type: String },
        locationVerificationSkipped: { type: Boolean }
      }
    ],
    // Allowed login radius in meters (configurable per user, default 100m)
    locationRadius: { type: Number, default: 100 },
    avatarUrl: { type: String },
    refreshTokens: [{ type: String }],
    activeDevices: [
      {
        deviceId: { type: String, required: true },
        browser: { type: String, default: 'Unknown' },
        os: { type: String, default: 'Unknown' },
        ip: { type: String, default: 'Unknown' },
        lastActive: { type: Date, default: Date.now }
      }
    ],
    // Audit: track consecutive failed login attempts
    failedLoginAttempts: { type: Number, default: 0 },
    lastFailedLoginAt: { type: Date },
    // Partner code
    userCode: { type: String, trim: true },
    // Toggles for bypassing face recognition, location verification, and status
    skipFace: { type: Boolean, default: false },
    skipLocation: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isApproved: { type: Boolean, default: false },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reportingManager: { type: Schema.Types.ObjectId, ref: 'User' },
    department: { type: String, trim: true }
  },
  { timestamps: true, versionKey: false }
);

// Indexes
UserSchema.index({ organizationId: 1 });

export default mongoose.model<IUser>('User', UserSchema);
