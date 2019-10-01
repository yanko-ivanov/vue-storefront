import { Category } from '../../types/Category';
import Product from '@vue-storefront/core/modules/catalog/types/Product';

export default interface CategoryState {
  categoriesMap: { [id: string]: Category },
  availableFilters: any,
  products: Product[],
  searchProductsStats: any
}
