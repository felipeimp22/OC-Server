/**
 * @fileoverview Barrel export for all read-only external Mongoose models.
 * These models map to existing OrderChop collections (owned by the Next.js app).
 *
 * @module domain/models/external
 */

export { Restaurant, type IRestaurantDocument } from './Restaurant.js';
export { Customer, type ICustomerDocument, type ICustomerPhone, type ICustomerAddress } from './Customer.js';
export { Order, type IOrderDocument, type IOrderItem, type ISelectedOption } from './Order.js';
export { StoreHours, type IStoreHoursDocument } from './StoreHours.js';
export { FinancialSettings, type IFinancialSettingsDocument } from './FinancialSettings.js';
export { UserRestaurant, type IUserRestaurantDocument } from './UserRestaurant.js';
export { RolePermissions, type IRolePermissionsDocument } from './RolePermissions.js';
export { User, type IUserDocument } from './User.js';
