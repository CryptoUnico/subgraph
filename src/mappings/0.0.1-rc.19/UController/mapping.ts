import {
  Address,
  BigInt,
  crypto,
  Entity,
  store,
} from '@graphprotocol/graph-ts';
import {
  getAvatarName,
  getAvatarReputation,
  getAvatarToken,
  getDAOTokenSupply,
  getRepSupply,
} from '../../../contractsUtils';
import * as domain from '../../../domain';

import {
  AvatarContract,
  ControllerScheme,
  ReputationContract,
  TokenContract,
  UControllerAddGlobalConstraint,
  UControllerGlobalConstraint,
  UControllerOrganization,
  UControllerRegisterScheme,
  UControllerRemoveGlobalConstraint,
  UControllerUnregisterScheme,
  UControllerUpgradeController,
} from '../../../types/schema';
import {
  AddGlobalConstraint,
  RegisterScheme,
  RemoveGlobalConstraint,
  UController,
  UnregisterScheme,
  UpgradeController,
} from '../../../types/UController/0.0.1-rc.19/UController';
import { concat, eventId } from '../../../utils';

function insertScheme(
  uControllerAddress: Address,
  avatarAddress: Address,
  scheme: Address,
): void {
  let uController = UController.bind(uControllerAddress);
  let paramsHash = uController.getSchemeParameters(scheme, avatarAddress);
  let perms = uController.getSchemePermissions(scheme, avatarAddress);

  let ent = new ControllerScheme(crypto.keccak256(concat(avatarAddress, scheme)).toHex());
  ent.dao = avatarAddress.toHex();
  ent.address = scheme;
  ent.paramsHash = paramsHash;
  /* tslint:disable:no-bitwise */
  ent.canRegisterSchemes = (perms[3] & 2) === 2;
  /* tslint:disable:no-bitwise */
  ent.canManageGlobalConstraints = (perms[3] & 4) === 4;
  /* tslint:disable:no-bitwise */
  ent.canUpgradeController = (perms[3] & 8) === 8;
  /* tslint:disable:no-bitwise */
  ent.canDelegateCall = (perms[3] & 16) === 16;

  store.set('ControllerScheme', ent.id, ent);
}

function deleteScheme(avatarAddress: Address, scheme: Address): void {
  store.remove(
    'ControllerScheme',
    crypto.keccak256(concat(avatarAddress, scheme)).toHex(),
  );
}

function insertOrganization(
  uControllerAddress: Address,
  avatarAddress: Address,
): void {
  let uController = UController.bind(uControllerAddress);
  let org = uController.organizations(avatarAddress);

  let reputationContract = new ReputationContract(org.value1.toHex());
  reputationContract.address = org.value1;
  reputationContract.totalSupply = getRepSupply(org.value1);
  store.set('ReputationContract', reputationContract.id, reputationContract);

  let tokenContract = new TokenContract(org.value0.toHex());
  tokenContract.address = org.value0;
  tokenContract.totalSupply = getDAOTokenSupply(org.value0);
  tokenContract.owner = uControllerAddress;
  store.set('TokenContract', tokenContract.id, tokenContract);

  let avatar = AvatarContract.load(avatarAddress.toHex());
  if (avatar != null) {
    avatar.address = avatarAddress;
    avatar.name = getAvatarName(avatarAddress);
    avatar.nativeReputation = getAvatarReputation(avatarAddress);
    avatar.nativeToken = getAvatarToken(avatarAddress);
    avatar.balance = BigInt.fromI32(0);
    store.set('AvatarContract', avatar.id, avatar as AvatarContract);
  }

  let ent = new UControllerOrganization(avatarAddress.toHex());
  ent.avatarAddress = avatarAddress;
  ent.nativeToken = org.value0.toHex();
  ent.nativeReputation = org.value1.toHex();
  ent.controller = uControllerAddress;
  store.set('UControllerOrganization', ent.id, ent);
}

function updateController(
  avatarAddress: Address,
  newController: Address,
): void {
  let ent = store.get(
    'UControllerOrganization',
    avatarAddress.toHex(),
  ) as UControllerOrganization;
  if (ent != null) {
    ent.controller = newController;
    store.set('UControllerOrganization', avatarAddress.toHex(), ent);
  }
}

function insertGlobalConstraint(
  uControllerAddress: Address,
  avatarAddress: Address,
  globalConstraint: Address,
  type: string,
): void {
  let uController = UController.bind(uControllerAddress);
  let paramsHash = uController.getGlobalConstraintParameters(
    globalConstraint,
    avatarAddress,
  );

  let ent = new UControllerGlobalConstraint(crypto.keccak256(concat(avatarAddress, globalConstraint)).toHex());
  ent.avatarAddress = avatarAddress;
  ent.address = globalConstraint;
  ent.paramsHash = paramsHash;
  ent.type = type;

  store.set('UControllerGlobalConstraint', ent.id, ent);
}

function deleteGlobalConstraint(
  avatarAddress: Address,
  globalConstraint: Address,
): void {
  store.remove(
    'UControllerGlobalConstraint',
    crypto.keccak256(concat(avatarAddress, globalConstraint)).toHex(),
  );
}

export function handleRegisterScheme(event: RegisterScheme): void {
  let uController = UController.bind(event.address);
  if (AvatarContract.load(event.params._avatar.toHex()) == null) {
     return;
  }

  let org = uController.organizations(event.params._avatar);
  domain.handleRegisterScheme(event.params._avatar, org.value0 , org.value1);

  // Detect a new organization event by looking for the first register scheme event for that org.
  let isFirstRegister = store.get(
    'FirstRegisterScheme',
    event.params._avatar.toHex(),
  );
  if (isFirstRegister == null) {
    insertOrganization(event.address, event.params._avatar);
    store.set(
      'FirstRegisterScheme',
      event.params._avatar.toHex(),
      new Entity(),
    );
  }

  insertScheme(event.address, event.params._avatar, event.params._scheme);

  let ent = new UControllerRegisterScheme(eventId(event));
  ent.txHash = event.transaction.hash;
  ent.controller = event.address;
  ent.contract = event.params._sender;
  ent.avatarAddress = event.params._avatar;
  ent.scheme = event.params._scheme;
  store.set('UControllerRegisterScheme', ent.id, ent);
}

export function handleUnregisterScheme(event: UnregisterScheme): void {
  deleteScheme(event.params._avatar, event.params._scheme);

  let ent = new UControllerUnregisterScheme(eventId(event));
  ent.txHash = event.transaction.hash;
  ent.controller = event.address;
  ent.contract = event.params._sender;
  ent.avatarAddress = event.params._avatar;
  ent.scheme = event.params._scheme;
  store.set('UControllerUnregisterScheme', ent.id, ent);
}

export function handleUpgradeController(event: UpgradeController): void {
  updateController(event.params._avatar, event.params._newController);

  let ent = new UControllerUpgradeController(eventId(event));
  ent.txHash = event.transaction.hash;
  ent.controller = event.params._oldController;
  ent.avatarAddress = event.params._avatar;
  ent.newController = event.params._newController;
  store.set('UControllerUpgradeController', ent.id, ent);
}

export function handleAddGlobalConstraint(event: AddGlobalConstraint): void {
  let when = event.parameters[2].value.toBigInt().toI32();
  let type: string;

  if (when === 0) {
    type = 'Pre';
  } else if (when === 1) {
    type = 'Post';
  } else {
    type = 'Both';
  }
  insertGlobalConstraint(
    event.address,
    event.params._avatar,
    event.params._globalConstraint,
    type,
  );

  let ent = new UControllerAddGlobalConstraint(eventId(event));
  ent.txHash = event.transaction.hash;
  ent.controller = event.address;
  ent.avatarAddress = event.params._avatar;
  ent.globalConstraint = event.params._globalConstraint;
  ent.paramsHash = event.params._params;
  ent.type = type;

  store.set('UControllerAddGlobalConstraint', ent.id, ent);
}

export function handleRemoveGlobalConstraint(
  event: RemoveGlobalConstraint,
): void {
  deleteGlobalConstraint(event.params._avatar, event.params._globalConstraint);

  let ent = new UControllerRemoveGlobalConstraint(eventId(event));
  ent.txHash = event.transaction.hash;
  ent.controller = event.address;
  ent.avatarAddress = event.params._avatar;
  ent.globalConstraint = event.params._globalConstraint;
  ent.isPre = event.params._isPre;
  store.set('UControllerRemoveGlobalConstraint', ent.id, ent);
}
