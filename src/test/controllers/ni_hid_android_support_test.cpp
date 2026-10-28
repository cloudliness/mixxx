#include <gtest/gtest.h>
#include <hidapi.h>

#include <QFileInfo>

#include "controllers/controllermappinginfo.h"
#include "controllers/hid/hiddevice.h"
#include "soundio/soundmanagerconfig.h"

namespace {

mixxx::hid::DeviceInfo deviceFor(uint16_t vendor,
        uint16_t product,
        int interfaceNumber,
        uint16_t usagePage,
        uint16_t usage) {
    hid_device_info info{};
    info.path = const_cast<char*>("");
    info.vendor_id = vendor;
    info.product_id = product;
    info.serial_number = const_cast<wchar_t*>(L"SERIAL");
    info.release_number = 0;
    info.manufacturer_string = const_cast<wchar_t*>(L"Native Instruments");
    info.product_string = const_cast<wchar_t*>(L"Traktor Kontrol");
    info.usage_page = usagePage;
    info.usage = usage;
    info.interface_number = interfaceNumber;
    info.bus_type = HID_API_BUS_USB;
    return mixxx::hid::DeviceInfo(info);
}

ProductInfo productFor(const char* vendor,
        const char* product,
        const char* interfaceNumber = "",
        const char* usagePage = "",
        const char* usage = "") {
    ProductInfo info;
    info.protocol = QStringLiteral("hid");
    info.vendor_id = QString::fromLatin1(vendor);
    info.product_id = QString::fromLatin1(product);
    info.interface_number = QString::fromLatin1(interfaceNumber);
    info.usage_page = QString::fromLatin1(usagePage);
    info.usage = QString::fromLatin1(usage);
    return info;
}

QString controllerMapping(const char* fileName) {
    return QString::fromUtf8(RESOURCE_FOLDER) +
            QStringLiteral("/controllers/") +
            QString::fromUtf8(fileName);
}

} // namespace

TEST(NiHidProductMatchTest, OriginalZ1MatchesWithoutInterface) {
    const auto device = deviceFor(0x17cc, 0x1210, 5, 0xff01, 0x00);
    EXPECT_TRUE(device.matchProductInfo(productFor("0x17cc", "0x1210")));
    EXPECT_FALSE(device.matchProductInfo(productFor("0x17cc", "0x1220")));
    EXPECT_FALSE(device.matchProductInfo(productFor("0x1234", "0x1210")));
}

TEST(NiHidProductMatchTest, F1AndX1Mk2RequireTheirHidInterface) {
    const auto f1Interface1 = deviceFor(0x17cc, 0x1120, 1, 0x01ff, 0x01);
    const auto f1Interface0 = deviceFor(0x17cc, 0x1120, 0, 0x01ff, 0x01);
    const ProductInfo f1 = productFor("0x17cc", "0x1120", "0x1", "0x1ff", "0x1");
    EXPECT_TRUE(f1Interface1.matchProductInfo(f1));
    EXPECT_FALSE(f1Interface0.matchProductInfo(f1));

    const auto x1Interface4 = deviceFor(0x17cc, 0x1220, 4, 0xff01, 0x00);
    const auto x1Interface0 = deviceFor(0x17cc, 0x1220, 0, 0xff01, 0x00);
    const ProductInfo x1 = productFor("0x17cc", "0x1220", "0x4", "0xff01", "0x0");
    EXPECT_TRUE(x1Interface4.matchProductInfo(x1));
    EXPECT_FALSE(x1Interface0.matchProductInfo(x1));
}

TEST(NiHidProductMatchTest, ShippedMappingIds) {
    const MappingInfo z1(QFileInfo(controllerMapping("Traktor Kontrol Z1.hid.xml")));
    ASSERT_TRUE(z1.isValid());
    ASSERT_EQ(z1.getProducts().size(), 1);
    EXPECT_EQ(z1.getProducts().at(0).vendor_id, QStringLiteral("0x17cc"));
    EXPECT_EQ(z1.getProducts().at(0).product_id, QStringLiteral("0x1210"));
    EXPECT_TRUE(z1.getProducts().at(0).interface_number.isEmpty());

    const MappingInfo f1(QFileInfo(controllerMapping("Traktor Kontrol F1.hid.xml")));
    ASSERT_TRUE(f1.isValid());
    ASSERT_EQ(f1.getProducts().size(), 1);
    EXPECT_EQ(f1.getProducts().at(0).product_id, QStringLiteral("0x1120"));
    EXPECT_EQ(f1.getProducts().at(0).interface_number, QStringLiteral("0x1"));

    const MappingInfo x1(QFileInfo(controllerMapping("Traktor Kontrol X1 MK2.hid.xml")));
    ASSERT_TRUE(x1.isValid());
    ASSERT_EQ(x1.getProducts().size(), 1);
    EXPECT_EQ(x1.getName(), QStringLiteral("Native Instruments Traktor Kontrol X1 MK2"));
    EXPECT_EQ(x1.getProducts().at(0).vendor_id, QStringLiteral("0x17cc"));
    EXPECT_EQ(x1.getProducts().at(0).product_id, QStringLiteral("0x1220"));
    EXPECT_EQ(x1.getProducts().at(0).interface_number, QStringLiteral("0x4"));

    const auto device = deviceFor(0x17cc, 0x1220, 4, 0xff01, 0x00);
    EXPECT_TRUE(device.matchProductInfo(x1.getProducts().at(0)));
    EXPECT_TRUE(deviceFor(0x17cc, 0x1210, 3, 0, 0).matchProductInfo(z1.getProducts().at(0)));
    EXPECT_TRUE(deviceFor(0x17cc, 0x1120, 1, 0x01ff, 0x01)
                    .matchProductInfo(f1.getProducts().at(0)));
}

TEST(OriginalKontrolZ1NameTest, RejectsMk2AndUnrelatedDevices) {
    EXPECT_TRUE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Traktor Kontrol Z1")));
    EXPECT_TRUE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Kontrol Z1: USB Audio")));
    EXPECT_FALSE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Traktor Kontrol Z1 MK2")));
    EXPECT_FALSE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Traktor Kontrol Z1 Mk2")));
    EXPECT_FALSE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Traktor Kontrol X1 MK2")));
    EXPECT_FALSE(SoundManagerConfig::isOriginalTraktorKontrolZ1(
            QStringLiteral("Traktor Kontrol F1")));
    EXPECT_FALSE(SoundManagerConfig::isOriginalTraktorKontrolZ1(QStringLiteral("Speaker")));
}
