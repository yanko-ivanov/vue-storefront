import * as types from '../../../store/mutation-types';
import cartActions from '../../../store/actions';
import config from 'config';
import rootStore from '@vue-storefront/core/store';
import { sha3_224 } from 'js-sha3';
import { TaskQueue } from '../../../../../lib/sync';
import { onlineHelper, isServer } from '@vue-storefront/core/helpers';

jest.mock('@vue-storefront/core/store', () => ({
  dispatch: jest.fn(),
  state: {}
}));
jest.mock('config', () => ({}));
jest.mock('@vue-storefront/i18n', () => ({ t: jest.fn(str => str) }));
jest.mock('js-sha3', () => ({ sha3_224: jest.fn() }));
jest.mock('@vue-storefront/core/lib/multistore', () => ({
  currentStoreView: jest.fn(),
  localizedRoute: jest.fn()
}));
jest.mock('@vue-storefront/core/lib/logger', () => ({
  Logger: {
    log: jest.fn(() => () => {}),
    debug: jest.fn(() => () => {}),
    warn: jest.fn(() => () => {}),
    error: jest.fn(() => () => {})
  }
}));
jest.mock('@vue-storefront/core/lib/sync', () => ({ TaskQueue: {
  execute: jest.fn()
}}));
jest.mock('@vue-storefront/core/app', () => ({ router: jest.fn() }));
jest.mock('@vue-storefront/core/lib/search/searchQuery', () => jest.fn());
jest.mock('@vue-storefront/core/helpers', () => ({
  get isServer () {
    return true
  },
  onlineHelper: {
    get isOnline () {
      return true
    }
  },
  processLocalizedURLAddress: (url) => url
}));

const EventBus = {
  $emit: jest.fn()
};

describe('Cart actions', () => {
  const isServerSpy = jest.spyOn((isServer).default, 'isServer', 'get');
  const isOnlineSpy = jest.spyOn(onlineHelper, 'isOnline', 'get');

  beforeEach(() => {
    jest.clearAllMocks();
    (rootStore as any).state = {};
    Object.keys(config).forEach((key) => { delete config[key]; });

    config.queues = {
      maxNetworkTaskAttempts: 1,
      maxCartBypassAttempts: 1
    }
  });

  it('disconnect clears cart token', () => {
    const contextMock = {
      commit: jest.fn()
    };
    const wrapper = (actions: any) => actions.disconnect(contextMock);

    wrapper(cartActions);

    expect(contextMock.commit).toBeCalledWith(types.CART_LOAD_CART_SERVER_TOKEN, null);
  });

  it('clear deletes all cart products and token', async () => {
    const contextMock = {
      commit: jest.fn(),
      getters: { isCartSyncEnabled: false }
    };
    const wrapper = (actions: any) => actions.clear(contextMock);

    config.cart = { synchronize: false };

    await wrapper(cartActions);

    expect(contextMock.commit).toBeCalledWith(types.CART_LOAD_CART, []);
  });

  it('clear dispatches creating a new cart on server with direct backend sync when its configured', async () => {
    const contextMock = {
      commit: jest.fn(),
      dispatch: jest.fn(),
      getters: { isCartSyncEnabled: true, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true }
    };

    config.cart = { synchronize: true };
    config.orders = { directBackendSync: true };

    const wrapper = (actions: any) => actions.clear(contextMock);

    await wrapper(cartActions);

    expect(contextMock.dispatch).toBeCalledWith('connect', {guestCart: false});
  });

  it('clear dispatches creating a new cart on server with queuing when direct backend sync is not configured', async () => {
    const contextMock = {
      commit: jest.fn(),
      dispatch: jest.fn(),
      getters: { isCartSyncEnabled: true, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true }
    };

    config.cart = { synchronize: true };
    config.orders = { directBackendSync: false };

    const wrapper = (actions: any) => actions.clear(contextMock);

    await wrapper(cartActions);

    expect(contextMock.dispatch).toBeCalledWith('connect', {guestCart: true});
  });

  describe('sync', () => {
    it('doesn\'t update shipping methods if cart is empty', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: true, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true },
        dispatch: jest.fn(),
        commit: jest.fn(),
        state: {
          cartItems: [],
          cartServerToken: 'some-token',
          cartItemsHash: 'some-sha-hash'
        }
      };

      config.cart = { synchronize: true };
      (rootStore as any).state = {
        checkout: {
          shippingDetails: {
            country: 'pl'
          }
        }
      };

      const expectedState = {
        cartItems: [],
        cartItemsHash: 'new-hash'
      };

      isServerSpy.mockReturnValueOnce(false);
      (sha3_224 as any).mockReturnValueOnce(expectedState.cartItemsHash);
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.sync(contextMock, {});

      await wrapper(cartActions);

      expect(contextMock.dispatch).not.toBeCalledWith(
        'cart/syncShippingMethods',
        { country_id: 'us' }
      );
    });
  });

  describe('syncTotals', () => {
    it('does not do anything if totals synchronization is off', () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        dispatch: jest.fn(),
        getters: { isCartSyncEnabled: false, isTotalsSyncEnabled: false, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true },
        state: {
          cartServerToken: 'some-token'
        }
      };

      config.cart = { synchronize_totals: false };

      const wrapper = (actions: any) => actions.syncTotals(contextMock);

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });

    it('does not do anything in SSR environment', () => {
      const contextMock = {
        commit: jest.fn(),
        dispatch: jest.fn(),
        getters: {
          isTotalsSyncRequired: false
        }
      };

      config.cart = { synchronize_totals: true };

      const wrapper = (actions: any) => actions.syncTotals(contextMock);

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });
  });

  describe('connect', () => {
    it('requests to backend for creation of a new cart', async () => {
      const contextMock = {
        getters: { isCartSyncEnabled: true, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true },
        state: {
          cartconnectdAt: 1000000000
        },
        commit: jest.fn(),
        dispatch: jest.fn()
      };

      config.cart = { synchronize: true };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => 1000003000);
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      await wrapper(cartActions);

      expect(TaskQueue.execute).toBeCalled();
    });

    it('requests to backend for creation of guest cart', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: true, isTotalsSyncRequired: true, isSyncRequired: true, isCartConnected: true },
        state: {
          cartconnectdAt: 1000000000
        }
      };

      config.cart = {
        synchronize: true,
        create_endpoint: 'http://example.url/guest-cart/{{token}}'
      };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => 1000003000);
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.connect(contextMock, { guestCart: true });

      await wrapper(cartActions);
      expect(TaskQueue.execute).toBeCalledWith(expect.objectContaining({ url: 'http://example.url/guest-cart/' }))
    });

    it('does not do anything if totals synchronization is off', () => {
      const contextMock = {
        getters: { isCartSyncEnabled: false }
      };

      config.cart = { synchronize: false };

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });
  });
});
