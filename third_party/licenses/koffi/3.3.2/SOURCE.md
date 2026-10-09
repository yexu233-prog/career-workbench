# Koffi 3.3.2随包补充许可

- 核对日期：2026-10-08；官方npm主包含Koffi、lib/native/base、node-addon-api和node-api-headers实际源码/许可，构建清单为src/koffi/CMakeLists.txt。打包分别保留其MIT全文，不把主包MIT替代依赖原文。
- 主包归档SHA-256：1c5189a71bab92a3b429e82456d10254ce1a1528a1c49f87f4e93ce944426cb0；下载：https://registry.npmjs.org/koffi/-/koffi-3.3.2.tgz。
- lib/native/base/unicode.inc标明DerivedCoreProperties-16.0.0来源；补充Unicode官方原文：https://www.unicode.org/license.txt，保存为Unicode-LICENSE.txt。
- lib/native/base/base.cc条件编译Dragonbox浮点格式化。无论最终优化是否保留该路径，均附上上游提供的Boost许可：https://raw.githubusercontent.com/jk-jeon/dragonbox/master/LICENSE-Boost，保存为Dragonbox-Boost.txt。此补充不声称反向确定二进制所用Dragonbox版本。
- Mac包只含运行入口和对应预编译绑定，不包含编译器/构建脚本，不运行npm install；组件的安装脚本从裁剪后的运行package.json移除。上游源归档及完整性记录保存在本机构建缓存。
- 该目录不是Apple系统框架的再分发副本。Security/CoreFoundation使用设备自带系统库，不打包Apple SDK或系统框架。
