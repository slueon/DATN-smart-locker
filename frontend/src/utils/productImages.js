// Cung cấp hình ảnh chất lượng cao (Unsplash CDN) và hàm resolve fallback cho sàn thương mại điện tử Smart Locker

export const PRODUCT_IMAGE_FALLBACKS = {
  earbuds: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
  hoodie: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80',
  backpack: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80',
  book: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80',
  keyboard: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80',
  mouse: 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&auto=format&fit=crop&q=80',
  default: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
};

/**
 * Xử lý link ảnh sản phẩm: tự động thay thế link placehold.co hoặc link hỏng bằng ảnh thực tế độ nét cao từ CDN
 */
export function resolveProductImage(product) {
  if (!product) return PRODUCT_IMAGE_FALLBACKS.default;
  const url = product.imageUrl || product.image_url;

  // Nếu có url hợp lệ và KHÔNG phải dịch vụ placeholder giả lập
  if (
    url &&
    typeof url === 'string' &&
    !url.includes('placehold.co') &&
    !url.includes('placeholder') &&
    !url.includes('dummyimage') &&
    url.startsWith('http')
  ) {
    return url;
  }

  const name = (product.name || '').toLowerCase();
  if (
    name.includes('tai nghe') ||
    name.includes('earbuds') ||
    name.includes('sound') ||
    name.includes('bluetooth') ||
    name.includes('wireless')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.earbuds;
  }
  if (
    name.includes('hoodie') ||
    name.includes('áo') ||
    name.includes('shirt') ||
    name.includes('thời trang')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.hoodie;
  }
  if (
    name.includes('balo') ||
    name.includes('laptop') ||
    name.includes('túi') ||
    name.includes('backpack')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.backpack;
  }
  if (
    name.includes('sách') ||
    name.includes('iot') ||
    name.includes('esp32') ||
    name.includes('book') ||
    name.includes('giáo trình')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.book;
  }
  if (
    name.includes('phím') ||
    name.includes('keyboard') ||
    name.includes('bàn phím')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.keyboard;
  }
  if (
    name.includes('chuột') ||
    name.includes('mouse')
  ) {
    return PRODUCT_IMAGE_FALLBACKS.mouse;
  }

  return PRODUCT_IMAGE_FALLBACKS.default;
}

/**
 * Tự động phân loại danh mục sản phẩm nếu backend không trả về trường category
 */
export function resolveProductCategory(product) {
  if (product?.category && product.category !== 'Sản phẩm') {
    return product.category;
  }
  const name = (product?.name || '').toLowerCase();
  if (name.includes('tai nghe') || name.includes('loa') || name.includes('audio')) {
    return 'Âm thanh';
  }
  if (name.includes('áo') || name.includes('hoodie') || name.includes('quần')) {
    return 'Thời trang';
  }
  if (name.includes('balo') || name.includes('túi') || name.includes('phím') || name.includes('chuột')) {
    return 'Phụ kiện';
  }
  if (name.includes('sách') || name.includes('iot') || name.includes('esp32') || name.includes('giáo trình')) {
    return 'Sách & Học tập';
  }
  return 'Phụ kiện';
}
