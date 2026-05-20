# Quick Start Guide - Taaza Resort Menu System

## 🎯 Quick Access Links

1. **Customer - Order Food Online**
   - URL: `delivery.html`
   - Features: Browse menu, add to cart, place orders, print bills

2. **Admin Panel - Manage Menu**
   - URL: `admin.html`
   - Password: `taaza123`
   - Features: Add/edit/delete menu items, view orders

---

## 💡 Key Features at a Glance

### 🛒 Online Delivery Page
- **Browse by Category**: Click category buttons to filter
- **Add Items**: Click "+ Add to Cart" on any item
- **View Bill**: Floating button shows cart count
- **Place Order**: Enter details and select payment method
- **Print Bill**: Generate professional receipt

### ⚙️ Admin Panel Tabs

| Tab | Purpose | Actions |
|-----|---------|---------|
| Dashboard | View stats | See counts of items, orders |
| Menu Items | Dine-in menu | Add, edit, delete items |
| Delivery Foods | Online menu | Add, toggle availability |
| Food Orders | Customer orders | View order details, clear history |
| Reservations | Room bookings | View reservations, clear history |

---

## 📊 Menu Summary

```
✅ 100+ Menu Items Added
✅ 23 Categories Organized
✅ Professional Food Images
✅ Prices in Nepali Rupees (Rs.)
✅ Delivery Time Estimates
✅ Full Descriptions
```

### Top Categories:
1. **Breakfast** (8) - Teas, coffees, omelettes
2. **Momo** (8) - Veg, chicken, buff variants
3. **Chicken** (8) - Fry, curry, tandoori, etc.
4. **Chowmein** (5) - Noodle variations
5. **Veg Items** (12) - Fritters, sides, snacks
6. **Beverages** (10+) - Lassi, drinks, beer, wine
7. **Soups** (6) - Traditional and modern
8. **Khaja Sets** (8) - Complete meal sets
9. **Meat Items** (15+) - Chicken, buff, mutton, fish, duck
10. ...and 13 more categories!

---

## 🔧 Common Tasks

### Add a New Menu Item
1. Go to Admin Panel (`admin.html`)
2. Login with password: `taaza123`
3. Click "Menu Items" tab
4. Fill form: Name, Category, Price, Emoji, Description
5. Click "Add Menu Item"
6. ✅ Item appears on delivery page!

### Make Item Available for Delivery
1. Go to Admin Panel
2. Click "Delivery Foods" tab
3. Add item or toggle existing item
4. Click "Show" button to make visible to customers
5. ✅ Appears on Online Delivery page!

### View Customer Orders
1. Go to Admin Panel
2. Click "Food Orders" tab
3. See all customer orders with:
   - Order number & time
   - Customer details
   - Items ordered
   - Payment method
   - Total amount

### Print a Bill
1. Place order on delivery page
2. After payment selection
3. View bill on screen
4. Click "Print Bill" button
5. Choose printer and print

---

## 💰 Price Reference (Sample Items)

| Item | Category | Price |
|------|----------|-------|
| Milk Tea | Breakfast | Rs. 35 |
| Veg Momo | Starters | Rs. 150 |
| Chicken Chowmein | Noodles | Rs. 200 |
| Chicken Fry | Main Course | Rs. 300 |
| Thakali Khaja Set | Sets | Rs. 350 |
| Local Chicken Curry | Special | Rs. 450 |
| Red Bull | Drinks | Rs. 150 |

*All prices include 13% VAT automatically*

---

## 📱 User Experience Flow

### For Customers:
```
Home → "Order Food Online" → Browse Menu
     → Filter by Category → Select Items
     → Add to Cart → Enter Delivery Details
     → Place Order → Choose Payment
     → Print Bill → Done! ✓
```

### For Admin:
```
Login (taaza123) → Dashboard (view stats)
                 → Manage Items (add/edit/delete)
                 → View Orders (track customer orders)
                 → View Reservations (track bookings)
```

---

## 🎨 Customization Tips

### Change Admin Password
Edit [admin.html](admin.html) line 3:
```javascript
const ADMIN_PASSWORD = 'taaza123'; // Change this
```

### Update Delivery Area
Edit [delivery.html](delivery.html) delivery service area text

### Modify VAT Rate
Edit in [delivery.html](delivery.html):
```javascript
var VAT_RATE = 0.13; // Currently 13%
```

### Add New Category
Simply add items with a new category name in Admin Panel - it will appear automatically!

---

## 📲 Mobile Experience

✅ **Fully Responsive** - Works on:
- Desktop browsers
- Tablets
- Mobile phones
- All screen sizes

---

## 🔒 Data Management

**Where is data stored?**
- Browser's localStorage (local to each computer)
- Survives browser closing
- Limited to ~5-10MB

**Backup Your Data**
- Admin Panel automatically saves to localStorage
- No backup needed for demo
- For production, use real database

**Clear Data**
- Use browser DevTools: Console > `localStorage.clear()`
- Or click "Seed Nepali Menu" in Admin to restore defaults

---

## ❓ Common Questions

**Q: How do customers access the menu?**
A: Send them to `delivery.html` or they can click "Order Food Online" from home page

**Q: Can I change menu item prices?**
A: Yes! Delete old item and add new one with updated price in Admin Panel

**Q: Do customers need to login?**
A: No login required for customers. Only admin panel needs password.

**Q: Where are the orders stored?**
A: In browser localStorage. Check Admin Panel → Food Orders tab

**Q: Can I add photos of our actual food?**
A: Yes! Replace Unsplash URLs with your own images. Each item has an `image` field.

**Q: How do I track delivery?**
A: Orders show in Admin Panel with customer address and items. Integrate SMS/email for notifications (optional).

---

## 🚀 Ready to Go!

Your menu system is **fully functional** and ready to start taking orders:

✅ Menu created with 100+ items  
✅ Categories organized  
✅ Admin panel working  
✅ Cart functionality active  
✅ Bill generation enabled  
✅ Professional design ready  

**Start by visiting:** `delivery.html`

---

## 📞 Technical Support

If something doesn't work:

1. **Items not showing?**
   - Clear browser cache (Ctrl+F5 / Cmd+Shift+R)
   - Check if Admin seeded the menu

2. **Cart not working?**
   - Enable JavaScript in browser
   - Check browser console for errors (F12)

3. **Admin not opening?**
   - Make sure password is correct: `taaza123`
   - Clear browser cache

4. **Prices not calculating?**
   - VAT should auto-calculate at 13%
   - Check cart modal is opening properly

---

**Happy Serving! 🍽️** 
Make sure to customize the content to match your actual restaurant details and images!
