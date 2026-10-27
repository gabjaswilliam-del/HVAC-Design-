# -*- coding: utf-8 -*-
"""
@author: shhmy
"""
# phyvac 模块。hvac + python -> phyvac
# 空调系统计算尽量基于物理原理与详细控制逻辑
# ver20231120
print("phyvac: ver20231120")
import math
import traceback
import numpy as np
import pandas as pd
# 使用非交互后端并禁用 show 弹窗
import matplotlib
# matplotlib.use('Agg')
import matplotlib.pyplot as plt
# plt.show = lambda *args, **kwargs: None
from scipy.interpolate import RegularGridInterpolator
from scipy import optimize
from sklearn.linear_model import LinearRegression


# 空气状态函数 ###############################################################
# 公式读法↓
# tdb_w2h   [输入]tdb(干球温度), w(绝对湿度) -> [输出] h(比焓)

# twb       湿球温度['C]
# tdb       干球温度['C]
# tdp       露点温度['C]
# w         绝对湿度[kg/kg']
# pv        水蒸气分压[kPa]            vapor pressure
# psat      饱和空气的水蒸气分压[kPa]   saturated vapor pressure
# h         比焓[kJ/kg']
# rh        相对湿度[%]
# den       密度[kg/m^3]              density
# p_atm     标准大气压[kPa]
# 大气压不是 1013.25 hPa，而是 101.325 kPa!!!

CA = 1.006  # 干空气定压比热 [kJ/kg・K]
CV = 1.86  # 水蒸气定压比热 [kJ/kg・K]
R0 = 2.501 * 10 ** 3  # 0°C 水的蒸发潜热 [kJ/kg]


# 干球温度和相对湿度求露点温度['C]
# 由给定的干球温度 tdb 和相对湿度 rh，求露点温度 tdp
def tdb_rh2tdp(tdb, rh):
    # 计算饱和水蒸气压 psat[mmHg]
    c = 373.16 / (273.16 + tdb)
    b = c - 1
    a = -7.90298 * b + 5.02808 * math.log10(c) - 1.3816 * 10 ** (-7) * (10 ** (11.344 * b / c) - 1) + 8.1328 * 10 ** (
        -3) * (10 ** (-3.49149 * b) - 1)
    psat = 760 * 10 ** a
    # 输入的绝对湿度
    x = 0.622 * (rh * psat) / 100 / (760 - rh * psat / 100)

    # 对应该绝对湿度、相对湿度 100% 的饱和水蒸气压 psat
    psat = 100 * 760 * x / (100 * (0.622 + x))
    psat0 = 0
    tdp_max = tdb
    tdp_min = -20
    tdp = 0
    cnt = 0
    # 找到饱和水蒸气压等于上述 psat 的温度 twb
    while (psat - psat0 < -0.01) or (psat - psat0 > 0.01):

        tdp = (tdp_max + tdp_min) / 2

        c = 373.16 / (273.16 + tdp)
        b = c - 1
        a = -7.90298 * b + 5.02808 * math.log10(c) - 1.3816 * 10 ** (-7) * (
                10 ** (11.344 * b / c) - 1) + 8.1328 * 10 ** (-3) * (10 ** (-3.49149 * b) - 1)
        psat0 = 760 * 10 ** a

        if psat - psat0 > 0:
            tdp_min = tdp
        else:
            tdp_max = tdp

        cnt += 1
        if cnt > 30:
            break

    return tdp


# 干球温度 tdb 与相对湿度 rh 求比焓 h[kJ/kg'] 和绝对湿度 x[kg/kg']
# 比焓 h = 干空气显热 + 水蒸气潜热 + 水蒸气显热，表示将 1kg 干空气及其所含水蒸气从 0°C 加热到当前温度所需总热量。
def tdb_rh2h_x(tdb, rh):
    # 计算饱和水蒸气压 Ps[mmHg]
    c = 373.16 / (273.16 + tdb)
    b = c - 1
    a = -7.90298 * b + 5.02808 * math.log10(c) - 1.3816 * 10 ** (-7) * (10 ** (11.344 * b / c) - 1) + 8.1328 * 10 ** (
        -3) * (10 ** (-3.49149 * b) - 1)
    psat = 760 * 10 ** a
    w = 0.622 * (rh * psat) / 100 / (760 - rh * psat / 100)
    h = CA * tdb + (R0 + CV * tdb) * w

    return [h, w]


# 干球温度求饱和水蒸气压[kPa]
# 从干球温度计算饱和水蒸气压[kPa]
def tdb2psat(tdb):
    # Wagner equation
    x = (1 - (tdb + 273.15) / 647.3)
    psat = 221200 * math.exp(
        (-7.76451 * x + 1.45838 * x ** 1.5 + -2.7758 * x ** 3 - 1.23303 * x ** 6) / (1 - x))  # [hPa]
    return psat / 10  # [hPa] -> [kPa]


# 干球温度和相对湿度求湿球温度['C]
# 从干球温度和相对湿度计算湿球温度['C]
def tdb_rh2twb(tdb, rh):
    psat = tdb2psat(tdb)
    pv_1 = rh / 100 * psat
    pv_2 = -99999
    twb = 0
    twb_max = 50
    twb_min = -50
    cnt = 0
    while abs(pv_1 - pv_2) > 0.01:
        twb = (twb_max + twb_min) / 2
        # Sprung 方程
        pv_2 = tdb2psat(twb) - 0.000662 * 101.325 * (tdb - twb)

        if pv_1 - pv_2 > 0:
            twb_min = twb
        else:
            twb_max = twb

        cnt += 1
        if cnt > 20:
            break

    return twb


# 干球温度与绝对湿度求比焓[kJ/kg']
# 从干球温度和绝对湿度计算比焓[kJ/kg']
def tdb_w2h(tdb, w):
    return CA * tdb + (CV * tdb + R0) * w


# 干球温度求饱和水蒸气压对应比焓[kJ/kg']
def tdb2hsat(tdb):
    psat = tdp2psat(tdb)
    wsat = pv2w(psat)
    hsat = tdb_w2h(tdb, wsat)
    return hsat


# 绝对湿度求蒸气压[kPa]
def w2pv(w, p_atm=101.325):
    return p_atm * w / (0.622 + w)


# 蒸气压求绝对湿度
def pv2w(pv, p_atm=101.325):
    w = 0.622 * pv / (p_atm - pv)
    return w


# 露点温度求饱和水蒸气压（单位推测为 kPa）
def tdp2psat(tdp):
    p_convert = 0.001

    c1 = -5.6745359e3
    c2 = 6.3925247
    c3 = -9.6778430e-3
    c4 = 6.2215701e-7
    c5 = 2.0747825e-9
    c6 = -9.4840240e-13
    c7 = 4.1635019

    n1 = 0.11670521452767e4
    n2 = -0.72421316703206e6
    n3 = -0.17073846940092e2
    n4 = 0.12020824702470e5
    n5 = -0.32325550322333e7
    n6 = 0.14915108613530e2
    n7 = -0.4823265731591e4
    n8 = 0.40511340542057e6
    n9 = -0.23855557567849e0
    n10 = 0.65017534844798e3

    t = tdp + 273.15
    if tdp < 0.01:
        psat = math.exp(c1 / t + c2 + c3 * t + c4 * t ** 2 + c5 * t ** 3 + c6 * t ** 4 + c7 * math.log(t)) * p_convert

    else:
        alpha = t + n9 / (t - n10)
        a2 = alpha ** 2
        a = a2 + n1 * alpha + n2
        b = n3 * a2 + n4 * alpha + n5
        c = n6 * a2 + n7 * alpha + n8
        psat = pow(2 * c / (-b + pow(b ** 2 - 4 * a * c, 0.5)), 4) / p_convert

    return psat


# 比焓与相对湿度求绝对湿度[kg/kg']
def h_rh2w(h, rh):
    tdb = h_rh2tdb(h, rh)
    w = tdb_rh2w(tdb, rh)
    return w


# 干球温度求密度[kg/m^3]
def tdb2den(tdb):
    return 1.293 * 273.3 / (273.2 + tdb)


# 比焓与相对湿度求干球温度['C]
def h_rh2tdb(h, rh):
    def h_rh2tdb_fun(tdb):
        return h - tdb_rh2h(tdb, rh)

    return optimize.newton(h_rh2tdb_fun, x0=1e-5, tol=1e-4, maxiter=20)


# 干球温度与相对湿度求比焓[kJ/kg']
def tdb_rh2h(tdb, rh):
    w = tdb_rh2w(tdb, rh)
    h = tdb_w2h(tdb, w)
    return h


# 干球温度与相对湿度求绝对湿度[kg/kg']
def tdb_rh2w(tdb, rh):
    psat = tdp2psat(tdb)
    pv = 0.01 * rh * psat
    w = pv2w(pv)
    return w


# 饱和水蒸气压求露点温度['C]
def psat2tdp(psat):
    p_convert = 0.001

    d1 = -6.0662e1
    d2 = 7.4624
    d3 = 2.0594e-1
    d4 = 1.6321e-2

    n1 = 0.11670521452767e4
    n2 = -0.72421316703206e6
    n3 = -0.17073846940092e2
    n4 = 0.12020824702470e5
    n5 = -0.32325550322333e7
    n6 = 0.14915108613530e2
    n7 = -0.4823265731591e4
    n8 = 0.40511340542057e6
    n9 = -0.23855557567849e0
    n10 = 0.65017534844798e3

    if psat < 0.611213:
        y = math.log(psat / p_convert)
        tdp = d1 + y * (d2 + y * (d3 + y * d4))
    else:
        ps = psat * p_convert
        beta = pow(ps, 0.25)
        b2 = beta ** 2
        e = b2 + n3 * beta + n6
        f = n1 * b2 + n4 * beta + n7
        g = n2 * b2 + n5 * beta + n8
        d = 2 * g / (-f - pow(f ** 2 - 4 * e * g, 0.5))
        tdp = (n10 + d - pow((n10 + d) ** 2 - 4 * (n9 + n10 * d), 0.5)) / 2 - 273.15
    return tdp


# 绝对湿度与比焓求干球温度['C]
def w_h2tdb(w, h):
    tdb = (h - 2501 * w) / (1.006 + 1.86 * w)
    return tdb


# 绝对湿度与相对湿度求干球温度['C]
def w_rh2tdb(w, rh):
    psat = w2pv(w)
    tdb = psat2tdp(psat / rh * 100)
    return tdb


# 绝对湿度求湿空气定压比热[kJ/kg･K] (= CA + CV)
def w2cpair(w):
    cpair = 1.006 + 1.86 * w
    return cpair


# 绝对湿度与干球温度求相对湿度
def w_tdb2rh(w, tdb):
    pv = w2pv(w)
    psat = tdp2psat(tdb)
    if psat <= 0:
        return 0
    else:
        return pv / psat * 100


# 干球温度与湿球温度求绝对湿度[kg/kg']
def tdb_twb2w(tdb, twb):
    psat = tdp2psat(twb)
    wsat = pv2w(psat)
    a = wsat * (2501 + (1.86 - 4.186) * twb) + 1.006 * (twb - tdb)  # 4.186[kJ/kg･K] 水的比热
    b = 2501 + 1.86 * tdb - 4.186 * twb
    return a / b


#######################
# HEX function
#######################
# 获取换热器计算所需参数
def getparameter_hex(tdb):
    delta = 0.001
    hws1 = tdb2hsat(tdb)
    hws2 = tdb2hsat(tdb + delta)
    fa = (hws2 - hws1) / delta
    fb = hws1 - fa * tdb
    return fa, fb


# 计算热通过有效度[-]
def hex_effectiveness(ntu, ratio_heat_cap, flowtype):
    # flowtype : {'counterflow', 'parallelflow'}
    ratio = ratio_heat_cap

    if ratio <= 0:
        return 1 - math.exp(-ntu)
    if ntu == 0:
        return 0
    if flowtype == 'counterflow':
        if ratio < 1:
            return (1 - math.exp((ratio - 1) * ntu)) / (1 - ratio * math.exp((ratio - 1) * ntu))
        else:
            return ntu / (1 + ntu)
    elif flowtype == 'parallelflow':
        if ratio < 1:
            return (1 - math.exp(-ntu * (ratio + 1))) / (1 + ratio)
        else:
            return 0.5 * (1 - math.exp(-2 * ntu))
    else:
        print('error:flowtype')


# 求 NTU（传热单元数 Number of transfer unit[-]）
def hex_ntu(feff, fratio_heat_cap, fflowtype):
    # flowtype : {'counterflow', 'parallelflow'}
    hex_eff = feff
    hex_ratio = fratio_heat_cap
    hex_flowtype = fflowtype

    def hex_efunc(fntu):
        return hex_eff - hex_effectiveness(fntu, hex_ratio, hex_flowtype)

    return optimize.newton(hex_efunc, x0=0, tol=1e-6, maxiter=20)  # rtol=1e-6 fprime=1e-4,


# 设备模型 ###############################################################

# 阀门特性
class Valve:
    """
    阀门类：用于模拟调节阀的流量-压力特性
    
    采用等百分比流量特性，根据阀门开度计算流量系数(CV值)，
    进而计算流量与压降之间的关系。
    
    流量特性公式：CV = CV_max * r^(vlv - 1)
    其中 r 为可调比，vlv 为阀门开度(0-1)
    """
    def __init__(self, cv_max=800, r=100):
        """
        初始化阀门对象
        
        参数:
            cv_max (float): 阀门全开时的最大流量系数(CV值)，默认800
                            CV值表示阀门在1psi压降下通过的流量(US gal/min)
            r (float): 可调比，表示阀门最小开度时流量与全开时流量的比值倒数，默认100
                       例如 r=100 表示最小开度时流量为全开的1/100
        
        实例变量:
            cv_max (float): 最大流量系数
            r (float): 可调比
            dp (float): 阀门压降（压差），单位[kPa]
                       压降 = P下游 - P上游，通常为负值（表示压力损失）
            vlv (float): 阀门开度，范围[0.0, 1.0]，0为全闭，1为全开
            g (float): 通过阀门的流量，单位[m³/s]或[m³/h]（需根据实际使用确认）
        """
        self.cv_max = cv_max
        self.r = r
        self.dp = 0.0  # 初始压降为0
        self.vlv = 0.0  # 初始开度为0（全闭）
        self.g = 0.0  # 初始流量为0

    def f2p(self, g):
        """
        根据流量计算阀门压降 (Flow to Pressure)
        
        压降（dp）就是压差（pressure difference），特指流体通过阀门时
        从上游到下游的压力损失（pressure drop）。
        
        使用等百分比流量特性公式：
        CV = CV_max * r^(vlv - 1)
        dp = -1743 * (g * 1000 / 60)^2 / CV^2
        
        其中：
        - 1743: 单位转换系数（将流量单位转换为标准CV值计算所需的单位）
        - 1000/60: 单位转换系数（可能是将m³/h转换为L/min或其他单位）
        - 负号表示压降方向：dp = P下游 - P上游 < 0（压力降低）
        
        注意：在HVAC系统中，通常将负的dp值取绝对值后作为压力损失使用
        
        参数:
            g (float): 通过阀门的流量，单位需与系统一致（通常为m³/s或m³/h）
        
        返回:
            float: 阀门压降（压差），单位[kPa]
                  - 负值：正常流向时的压降（P下游 < P上游，压力损失）
                  - 正值：逆流时的压降（或计算结果的符号反转）
                  - -99999999：阀门全闭时的极大压降（阻止流动）
        """
        self.g = g
        
        # 如果阀门全闭，返回极大的压降值（阻止流动）
        if self.vlv == 0.0:
            self.dp = -99999999
        # 计算当前开度下的流量系数CV值
        # CV = CV_max * r^(vlv - 1)，这是等百分比特性的核心公式
        elif (self.cv_max * self.r ** (self.vlv - 1)) ** 2 > 0:
            # 根据流量计算压降
            # 公式：dp = -1743 * (1000/60)^2 * g^2 / CV^2
            # 这里将公式重组为：dp = [-1743 * (1000/60)^2 / CV^2] * g^2
            cv = self.cv_max * self.r ** (self.vlv - 1)  # 当前开度下的流量系数
            self.dp = (- 1743 * (1000 / 60) ** 2 / cv ** 2) * self.g ** 2
        else:
            # 防止除零错误，如果CV^2为0或负数，压降设为0
            self.dp = 0.0

        # 如果流量为负（逆流），压降方向也要反转
        if self.g < 0:
            self.dp = -self.dp
        
        return self.dp

    def p2f(self, dp):
        """
        根据压降（压差）计算通过阀门的流量 (Pressure to Flow)
        
        这是f2p方法的逆运算，从压降反推流量。
        公式：g = sqrt(dp / [-1743 * (1000/60)^2 / CV^2])
        
        参数:
            dp (float): 阀门压降（压差），单位[kPa]
                       压降 = P下游 - P上游
                       - 负值：正常流向的压降（P下游 < P上游）
                       - 正值：逆流时的压降（P下游 > P上游）
        
        返回:
            float: 通过阀门的流量，单位与系统一致（通常为m³/s或m³/h）
                  - 正值：正常流向
                  - 负值：逆流
        """
        self.dp = dp
        
        # 如果阀门全闭，流量为0
        if self.vlv == 0.0:
            self.g = 0
        # 正常流向（压降为负）
        elif self.dp < 0:
            # 从压降反推流量：g = sqrt(dp / 系数)
            # 系数 = -1743 * (1000/60)^2 / CV^2
            cv = self.cv_max * self.r ** (self.vlv - 1)  # 当前开度下的流量系数
            coefficient = -1743 * (1000 / 60) ** 2 / cv ** 2
            self.g = (self.dp / coefficient) ** 0.5
        else:
            # 逆流情况（压降为正），流量为负值
            cv = self.cv_max * self.r ** (self.vlv - 1)  # 当前开度下的流量系数
            coefficient = 1743 * (1000 / 60) ** 2 / cv ** 2
            self.g = -(self.dp / coefficient) ** 0.5  # 逆流，流量为负

        return self.g

    def f2p_co(self):
        """
        返回f2p方法的系数，用于线性化或系数提取
        
        该方法返回一个数组，表示压降与流量的二次关系：
        dp = a * g^2 + b * g + c
        
        对于等百分比阀门特性，a=0, b=0, c=系数值
        即：dp = c * g^2
        
        返回:
            numpy.ndarray: 系数数组 [a, b, c]
                         - a: g^2的系数（通常为0）
                         - b: g的系数（通常为0）
                         - c: 常数项系数，即 -1743 * (1000/60)^2 / CV^2
                            如果阀门全闭，返回-99999999（极大值）
        """
        if self.vlv == 0.0:
            # 阀门全闭时，返回极大系数值，表示极大的阻力
            return np.array([0, 0, -99999999])
        else:
            # 计算当前开度下的系数
            # 系数 = -1743 * (1000/60)^2 / CV^2
            cv = self.cv_max * self.r ** (self.vlv - 1)  # 当前开度下的流量系数
            coefficient = -1743 * (1000 / 60) ** 2 / cv ** 2
            return np.array([0, 0, coefficient])


# 泵特性与耗电计算
class Pump:
    # 泵类：用于模拟水泵的性能特性，包括压力-流量关系和效率计算
    # 定格参数输入
    def __init__(self, pg=None, eg=None, r_ef=0.8, g_d=0.25, inv=1.0, figure=1):
        # 初始化方法：创建泵对象并设置初始参数
        # pg     : 压力-流量(pg)曲线系数（常数、一阶、二阶）
        # eg     : 效率-流量(eg)曲线系数（常数、一阶、二阶）
        # r_ef   : 额定工况最高效率（本应计算得到）
        # inv    : 转速比(0.0~1.0)
        # dp_p   : 泵扬程[kPa]
        # g      :流量[m3/min] - 流量[m3/min]
        # g_d    : 额定流量[m3/min]
        # pw_p   : 消耗功率[kW]
        # flag   : 计算异常标志，1有问题，0正常
        # ef     : 效率(0.0~1.0)
        # para   : 是否并联泵标志
        # figure : 1 绘制性能曲线，非1则不绘制

        # 获取调用栈信息，用于提取实例名称
        (filename, line_number, function_name, text) = traceback.extract_stack()[-2]
        # 从调用栈文本中提取实例名称（等号前的部分），并去除首尾空格
        self.name = text[:text.find('=')].strip()  # 获取实例名（需在 __init__ 最前执行）
        # 如果未提供压力-流量曲线系数，使用默认值
        if pg is None:
            # 默认的压力-流量曲线系数：[常数项, 一次项系数, 二次项系数]
            self.pg = [233, 5.9578, -4.95]
        else:
            # 使用提供的压力-流量曲线系数
            self.pg = pg
        # 如果未提供效率-流量曲线系数，使用默认值
        if eg is None:
            # 默认的效率-流量曲线系数：[常数项, 一次项系数, 二次项系数]
            self.eg = [0.0099, 0.4174, -0.0508]
        else:
            # 使用提供的效率-流量曲线系数
            self.eg = eg
        # 设置额定效率
        self.r_ef = r_ef
        # 设置转速比
        self.inv = inv
        # 设置额定流量
        self.g_d = g_d
        # 初始化扬程为0
        self.dp = 0.0
        # 初始化流量为0
        self.g = 0.0
        # 初始化效率为0
        self.ef = 0.0
        # 初始化消耗功率为0
        self.pw = 0.0
        # 初始化计算标志为0（正常状态）
        self.flag = 0
        # 初始化并联标志为0（非并联）
        self.para = 0

        # 如果figure参数为1，则绘制性能曲线
        if figure == 1:
            # 调用绘制性能曲线的方法
            self.figure_curve()

    def f2p(self, g):  # flow to pressure for pump
        # 根据流量计算压力（扬程）的方法
        # 参数g：当前流量[m3/min]
        # 将输入的流量值保存到实例变量中
        self.g = g
        # 仅在流量>0且转速比>0时计算扬程
        if self.g > 0 and self.inv > 0:
            # 根据压力-流量曲线公式计算扬程
            # 公式：dp = (pg[0] + pg[1] * (g/inv) + pg[2] * (g/inv)^2) * inv^2
            # 其中 g/inv 是将当前流量转换为额定转速下的等效流量
            # inv^2 是转速比的平方，用于修正扬程
            self.dp = (self.pg[0] + self.pg[1] * (self.g / self.inv) + self.pg[2] * (
                        self.g / self.inv) ** 2) * self.inv ** 2
        else:
            # 如果流量或转速比为0，则扬程为0
            self.dp = 0.0

        # 检查计算出的扬程是否为负值
        if self.dp < 0:
            # 如果扬程为负，将其设为0（物理上不合理）
            self.dp = 0.0
            # 设置标志为1，表示计算有问题
            self.flag = 1
        else:
            # 如果扬程正常，设置标志为0
            self.flag = 0

        # 返回计算得到的扬程值
        return self.dp

    def f2p_co(self):  # coefficient for f2p
        # 返回f2p方法的系数（用于其他计算）
        # 根据当前转速比调整压力-流量曲线的系数
        # 返回调整后的系数列表：[常数项*inv^2, 一次项系数*inv, 二次项系数]
        return [self.pg[0] * self.inv ** 2, self.pg[1] * self.inv, self.pg[2]]

    def cal(self):
        # 计算泵的完整性能：效率、扬程、功率；仅在流量>0且转速比>0时计算功率
        if self.g > 0 and self.inv > 0:

            # G: INV=1.0（额定）下的等效流量
            g = self.g / self.inv
            # K: 效率换算系数，考虑转速影响（inv^0.2 为经验修正）
            k = (1.0 - (1.0 - self.r_ef) / (self.inv ** 0.2)) / self.r_ef
            # ef: 効率 - 根据效率-流量曲线和换算系数计算当前效率
            # 公式：ef = k * (eg[0] + eg[1] * g + eg[2] * g^2)
            self.ef = k * (self.eg[0] + self.eg[1] * g + self.eg[2] * g ** 2)

            # 根据压力-流量曲线计算扬程
            # 公式：dp = (pg[0] + pg[1] * g + pg[2] * g^2) * inv^2
            self.dp = (self.pg[0] + self.pg[1] * g + self.pg[2] * g ** 2) * self.inv ** 2
            # 检查扬程是否为负值
            if self.dp < 0:
                # 如果为负，设为0
                self.dp = 0.0
                # 设置错误标志
                self.flag = 1
            # print(Nm)

            #  軸動力を求める - 计算轴功率（消耗功率）
            if self.ef > 0:
                # 如果效率大于0，根据公式计算消耗功率
                # 公式：pw = (g * dp) / (60 * ef)
                # 其中：g为流量[m3/min]，dp为扬程[kPa]，ef为效率
                # 60是单位换算系数（将分钟转换为秒）
                self.pw = 1.0 * self.g * self.dp / (60 * self.ef)
                # 计算成功，设置标志为0
                self.flag = 0
            else:
                # 如果效率为0或负值，无法计算功率
                self.pw = 0.0
                # 设置标志为2，表示效率异常
                self.flag = 2
            # print(self.flag)

        else:
            # 如果流量或转速比为0，所有性能参数都设为0
            self.pw = 0.0
            self.ef = 0.0
            self.flag = 0

    def figure_curve(self):
        x_max, _ = quadratic_formula(self.pg[0], self.pg[1], self.pg[2])
        x = np.linspace(0, self.g_d, 50)
        y_p = (self.pg[0] + self.pg[1] * (x/self.inv) + self.pg[2] * (x/self.inv) ** 2) * self.inv ** 2
        x2_max, _ = quadratic_formula(self.pg[0] * self.inv ** 2, self.pg[1] * self.inv, self.pg[2])
        # x2 = np.linspace(0, min(self.g_d, x2_max, self.g_d*self.inv), 50)
        x2 = np.linspace(0, self.g_d * self.inv, 50)
        k = (1.0 - (1.0 - self.r_ef) / (self.inv ** 0.2)) / self.r_ef
        y_e = k * (self.eg[0] + self.eg[1] * (x2/self.inv) + self.eg[2] * (x2/self.inv) ** 2)
        fig, ax1 = plt.subplots()
        color1 = 'tab:orange'
        ax1.set_xlabel('Flow [m3/min]')
        ax1.set_ylabel('Pressure [kPa]', color=color1)
        ax1.plot(x, y_p, color=color1)
        ax1.tick_params(axis='y', labelcolor=color1)
        ax1.set_ylim(0, self.pg[0] + 10)

        ax2 = ax1.twinx()
        color2 = 'tab:blue'
        ax2.set_ylabel('Efficiency [-]', color=color2)
        ax2.plot(x2, y_e, color=color2)
        ax2.tick_params(axis='y', labelcolor=color2)
        ax2.set_ylim(0, 1)
        plt.title('{}'.format(self.name))

        return plt.show()


# 基于负荷率-COP 曲线的冷冻机 COP 计算（表格需按负荷率/冷却水入口温度从左到右、从上到下递增）
class Chiller:
    """
    冷冻机组类
    
    基于负荷率-COP曲线的冷冻机COP计算，支持从Excel文件读取设备规格和性能数据
    具有完整的冷冻机性能计算、压力损失计算和状态标志功能
    """
    # 定格参数输入
    def __init__(self, filename='equipment_spec.xlsx', sheet_name='Chiller'):
        """
        初始化冷冻机组
        
        Args:
            filename (str): 设备规格Excel文件名，默认'equipment_spec.xlsx'
            sheet_name (str): 工作表名称，默认'Chiller'
        """
        # tin   :入口温度[℃]
        # tout  :出口温度[℃]
        # g     :流量[m3/min]
        # q     : 热量[kW]
        # ch    : 冷水（chilled water）
        # cd    : 冷却水(condenser water)
        # d     : 定格值
        # pw    : 消耗功率[kW]
        # pl    : 部分负荷率(load factor, 0.0~1.0)
        # dp_ch_d : 蒸发器额定压损[kPa]
        # dp_cd_d : 冷凝器额定压损[kPa]
        # dp    : 设备压损[kPa]
        
        # 从Excel文件读取设备规格数据
        spec_table = pd.read_excel(filename, sheet_name=sheet_name, header=None)
        self.tout_ch_d = float(spec_table.iat[1, 0])  # 冷水出口温度设定值 [°C]
        self.tin_ch_d = float(spec_table.iat[1, 1])   # 冷水入口温度 [°C]
        self.g_ch_d = float(spec_table.iat[1, 2])     # 冷水流量 [m3/min]
        self.tin_cd_d = float(spec_table.iat[1, 3])   # 冷却水入口温度 [°C]
        self.tout_cd_d = float(spec_table.iat[1, 4])  # 冷却水出口温度 [°C]
        self.g_cd_d = float(spec_table.iat[1, 5])     # 冷却水流量 [m3/min]
        
        # 额定主电动机输入功率 [kW]
        self.pw_d = float(spec_table.iat[1, 6])
        self.dp_ch_d = float(spec_table.iat[1, 7])    # 蒸发器压力损失 [kPa]
        self.dp_cd_d = float(spec_table.iat[1, 8])    # 冷凝器压力损失 [kPa]

        # 计算额定冷冻容量 [kW]
        # 优先从表格最后一列读取额定冷量（"1700RT" 或 "1758kW" 等），按单位解析。
        # 如读取失败或为空，则退回按 ΔT × 额定流量公式计算。
        q_ch_d_kw = None
        try:
            # 假设额定冷量列位于第 9 列（索引 9），内容可能为数值或带 "RT"/"kW" 的字符串
            cap_cell = spec_table.iat[1, 9]
            if pd.notna(cap_cell):
                cap_str = str(cap_cell).strip()
                if cap_str:
                    import re
                    num_str = "".join(re.findall(r"[0-9.]+", cap_str))
                    if num_str:
                        cap_val = float(num_str)
                        cap_upper = cap_str.upper().replace(" ", "")
                        if "KW" in cap_upper:
                            q_ch_d_kw = cap_val
                        elif "RT" in cap_upper:
                            q_ch_d_kw = cap_val * 3.517
                        else:
                            # 兼容旧表：纯数字按 RT 处理
                            q_ch_d_kw = cap_val * 3.517
        except Exception:
            q_ch_d_kw = None

        if q_ch_d_kw is None or q_ch_d_kw <= 0:
            # 回退：根据额定工况温差和额定冷水流量估算
            self.q_ch_d = (self.tin_ch_d - self.tout_ch_d) * self.g_ch_d * 1000 * 4.186 / 60
        else:
            self.q_ch_d = float(q_ch_d_kw)
        
        # 辅机电力 [kW]
        self.pw_sub = 0
        
        # 额定冷冻机COP
        self.COP_rp = self.q_ch_d / self.pw_d
        
        # 以下为每时刻可能变化的值
        self.tout_ch = 7      # 冷水出口温度 [°C]
        self.tout_cd = 37     # 冷却水出口温度 [°C]
        self.g_ch = 0         # 冷水流量 [m3/min]
        self.g_cd = 0         # 冷却水流量 [m3/min]
        self.pw = 0           # 消费电力 [kW]
        self.q_ch = 0         # 冷冻热量 [kW]
        self.pl = 0           # 负荷率 (0.0~1.0)
        self.cop = 0          # COP值
        self.flag = 0         # 状态标志：0=正常，1-5=各种异常状态
        self.dp_ch = 0        # 蒸发器压力损失 [kPa]
        self.dp_cd = 0        # 冷凝器压力损失 [kPa]
        self.tin_cd = 15      # 冷却水入口温度 [°C]
        self.tin_ch = 7       # 冷水入口温度 [°C]
        self.tout_ch_sp = 7.0 # 冷水出口温度设定值 [°C]

        # 处理COP性能数据表
        pl_cop = spec_table.drop(spec_table.index[[0, 1, 2]])  # 删除前3行
        pl_cop.iat[0, 0] = '-'  # 设置第一行第一列为'-'
        pl_cop = pl_cop.dropna(how='all', axis=1)  # 删除全空列
        self.data = pl_cop.values  # 转换为numpy数组

    # 基于设备特性表计算冷冻机 COP
    def cal(self, tout_ch_sp, tin_ch, g_ch, tin_cd, g_cd):
        """
        冷冻机性能计算
        
        Args:
            tout_ch_sp (float): 冷水出口温度设定值 [°C]
            tin_ch (float): 冷水入口温度 [°C]
            g_ch (float): 冷水流量 [m3/min]
            tin_cd (float): 冷却水入口温度 [°C]
            g_cd (float): 冷却水流量 [m3/min]
        """
        self.flag = 0
        self.tout_ch_sp = tout_ch_sp
        self.tin_ch = tin_ch
        self.g_ch = g_ch
        self.tin_cd = tin_cd
        self.g_cd = g_cd
        
        # 冷水出口温度 [°C]
        self.tout_ch = self.tout_ch_sp
        
        # 冷冻热量计算 [kW]
        self.q_ch = (self.tin_ch - self.tout_ch) * self.g_ch * 1000 * 4.186 / 60
        
        # 无冷却水时，q_ch=0
        if self.g_cd <= 0:
            self.q_ch = 0

        if self.q_ch > 0 and self.g_cd > 0:  # 有负荷且有冷却水
            # 提取COP性能数据
            pl = self.data[0][1:].astype(np.float32)      # 负荷率数组
            temp = self.data.transpose()[0][1:].astype(np.float32)  # 温度数组
            dataset = self.data[1:].transpose()[1:].transpose().astype(np.float32)  # COP数据矩阵
            cop = RegularGridInterpolator((temp, pl), dataset)  # 创建插值器

            # 部分负荷率计算
            self.pl = self.q_ch / self.q_ch_d
            pl_cop = self.pl
            
            # 负荷率超上限处理
            if self.pl > pl[-1]:
                self.pl = pl[-1]
                pl_cop = self.pl
                # 调整冷水出口温度以适应超负荷
                self.tout_ch += (self.q_ch - self.q_ch_d) / (self.g_ch * 1000 * 4.186 / 60)
                self.q_ch = self.q_ch_d
                self.flag = 1  # 超负荷标志

            # 负荷率低于下限处理：
            # 优先用最低 PL；但若最低 PL 列存在非正 COP（部分设备表确有 0），
            # 回退到最高 PL 避免后续出现除零。
            elif self.pl < pl[0]:
                pl_cop = pl[0]
                if bool(np.any(dataset[:, 0] <= 0)):
                    pl_cop = pl[-1]
                self.flag = 2  # 低负荷标志

            # 冷却水入口温度修正（考虑冷水出口温度影响）
            tin_cd_cop = self.tin_cd - (self.tout_ch - self.tout_ch_d)

            # 温度修正值边界检查
            if tin_cd_cop < temp[0]:
                tin_cd_cop = temp[0]
                self.flag = 3  # 温度过低标志
            elif tin_cd_cop > temp[-1]:
                tin_cd_cop = temp[-1]
                self.flag = 4  # 温度过高标志

            # 硬裁剪到性能表网格（消除浮点边界与分支遗漏导致的 RGI 越界）
            pl_lo = float(np.min(pl))
            pl_hi = float(np.max(pl))
            tin_lo = float(np.min(temp))
            tin_hi = float(np.max(temp))
            pl_cop = float(np.clip(pl_cop, pl_lo, pl_hi))
            tin_cd_cop = float(np.clip(tin_cd_cop, tin_lo, tin_hi))

            # COP插值计算
            self.cop = cop([[tin_cd_cop, pl_cop]]).item()
            if (not np.isfinite(self.cop)) or self.cop <= 1e-9:
                # 保险兜底：极端参数可能导致插值得到非正/非数 COP，避免训练中断
                pos_vals = dataset[np.isfinite(dataset) & (dataset > 1e-9)]
                self.cop = float(np.min(pos_vals)) if pos_vals.size else 1e-6
                self.flag = max(self.flag, 6)
            
            # 消费电力计算 [kW]
            self.pw = self.q_ch / self.cop + self.pw_sub
            
            # 冷却水出口温度计算 [°C]
            self.tout_cd = (self.q_ch + self.pw) / (4.186 * self.g_cd * 1000 / 60) + self.tin_cd

        elif self.q_ch == 0:  # 无负荷状态
            self.pw = 0
            self.cop = 0
            self.pl = 0
            self.flag = 0  # 正常停机状态
        else:  # 异常状态（有负荷但无冷却水）
            self.pw = 0
            self.cop = 0
            self.pl = 0
            self.flag = 5  # 异常状态标志

        # 压力损失：直接采用表格给定定值（表中为压损绝对值，模型内部按负号表示损失）
        self.dp_ch = -self.dp_ch_d  # 蒸发器压力损失 [kPa]
        self.dp_cd = -self.dp_cd_d  # 冷凝器压力损失 [kPa]


class DualModeChiller:
    """
    双工况水冷离心冷水机组（CHL 制冷/蓄冷、CH 低温/中温等）。

    每种 operating_mode 对应独立 Chiller 性能表（独立 xlsx/sheet）。
    对外接口与 Chiller 保持一致，便于接入现有仿真步进逻辑。
    """

    def __init__(
        self,
        mode_specs: dict,
        default_mode: str = "cooling",
        *,
        resolve_path=None,
    ):
        """
        Args:
            mode_specs: {mode_name: {"filename": str, "sheet_name": str}, ...}
            default_mode: 初始运行模式
            resolve_path: 可选 callable(filename) -> 绝对路径
        """
        if not mode_specs:
            raise ValueError("DualModeChiller.mode_specs 不能为空")
        self.mode_specs = dict(mode_specs)
        self.modes: dict = {}
        for mode, spec in self.mode_specs.items():
            fn = str(spec.get("filename", "equipment_spec.xlsx"))
            sh = str(spec.get("sheet_name", "Chiller"))
            if resolve_path is not None:
                fn = str(resolve_path(fn))
            self.modes[mode] = Chiller(filename=fn, sheet_name=sh)
        if default_mode not in self.modes:
            default_mode = next(iter(self.modes))
        self.operating_mode = str(default_mode)
        self._sync_from_active()

    @property
    def _active(self) -> Chiller:
        return self.modes[self.operating_mode]

    def set_mode(self, mode: str) -> None:
        if mode not in self.modes:
            raise ValueError(f"未知运行模式 {mode!r}，可选: {list(self.modes)}")
        self.operating_mode = str(mode)
        self._sync_from_active()

    def _sync_from_active(self) -> None:
        ch = self._active
        for attr in (
            "tout_ch_d", "tin_ch_d", "g_ch_d", "tin_cd_d", "tout_cd_d", "g_cd_d",
            "q_ch_d", "pw_d", "dp_ch_d", "dp_cd_d", "COP_rp",
            "tout_ch", "tout_cd", "g_ch", "g_cd", "pw", "q_ch", "pl", "cop", "flag",
            "dp_ch", "dp_cd", "tin_cd", "tin_ch", "tout_ch_sp",
        ):
            setattr(self, attr, getattr(ch, attr))

    def cal(self, tout_ch_sp, tin_ch, g_ch, tin_cd, g_cd):
        self._active.cal(tout_ch_sp, tin_ch, g_ch, tin_cd, g_cd)
        self._sync_from_active()


class HeatRecoveryChiller:
    """
    中温热回收水冷离心冷水机组（CHM）。

    - 供冷侧：同 Chiller（蒸发器）
    - 热回收侧：可选独立性能 sheet；无表时用设计点额定热回收量按负荷率估算
    """

    def __init__(
        self,
        cooling_spec: dict,
        heat_recovery_spec=None,
        *,
        resolve_path=None,
    ):
        fn = str(cooling_spec.get("filename", "equipment_spec.xlsx"))
        sh = str(cooling_spec.get("sheet_name", "CoolingMode"))
        if resolve_path is not None:
            fn = str(resolve_path(fn))
        self.cooler = Chiller(filename=fn, sheet_name=sh)
        self.heat_recovery_enabled = False
        self.q_hr = 0.0
        self.pl_hr = 0.0
        self.pw_hr = 0.0
        self.cop_hr = 0.0
        self.g_hr = 0.0
        self.tin_hr = 32.0
        self.tout_hr = 38.0
        self.tout_hr_sp = 38.0
        self.q_hr_d = 0.0
        self.pw_hr_d = 0.0
        self.g_hr_d = 0.0
        self.tout_hr_d = 38.0
        self.tin_hr_d = 32.0
        self._hr_cop = None
        self.operating_mode = "cooling"  # cooling | heat_recovery | simultaneous

        if heat_recovery_spec:
            hr_fn = str(heat_recovery_spec.get("filename", fn))
            hr_sh = str(heat_recovery_spec.get("sheet_name", "HeatRecoveryMode"))
            if resolve_path is not None:
                hr_fn = str(resolve_path(hr_fn))
            try:
                hr_ch = Chiller(filename=hr_fn, sheet_name=hr_sh)
                self.q_hr_d = float(hr_ch.q_ch_d)
                self.pw_hr_d = float(hr_ch.pw_d)
                self.g_hr_d = float(hr_ch.g_ch_d)
                self.tout_hr_d = float(hr_ch.tout_ch_d)
                self.tin_hr_d = float(hr_ch.tin_ch_d)
                self._hr_cop = hr_ch
            except Exception:
                pass
            self.q_hr_d = float(heat_recovery_spec.get("q_hr_d_kw", self.q_hr_d or 0.0))
            self.pw_hr_d = float(heat_recovery_spec.get("pw_hr_d_kw", self.pw_hr_d or 0.0))
            self.g_hr_d = float(heat_recovery_spec.get("g_hr_d_m3min", self.g_hr_d or 0.0))
            self.tout_hr_d = float(heat_recovery_spec.get("tout_hr_d_c", self.tout_hr_d))
            self.tin_hr_d = float(heat_recovery_spec.get("tin_hr_d_c", self.tin_hr_d))
        self._sync_from_cooler()

    def _sync_from_cooler(self) -> None:
        ch = self.cooler
        for attr in (
            "tout_ch_d", "tin_ch_d", "g_ch_d", "tin_cd_d", "tout_cd_d", "g_cd_d",
            "q_ch_d", "pw_d", "dp_ch_d", "dp_cd_d", "COP_rp",
            "tout_ch", "tout_cd", "g_ch", "g_cd", "pw", "q_ch", "pl", "cop", "flag",
            "dp_ch", "dp_cd", "tin_cd", "tin_ch", "tout_ch_sp",
        ):
            setattr(self, attr, getattr(ch, attr))

    def cal(
        self,
        tout_ch_sp,
        tin_ch,
        g_ch,
        tin_cd,
        g_cd,
        *,
        heat_recovery_active: bool = False,
        tout_hr_sp=None,
        tin_hr=None,
        g_hr=0.0,
    ):
        self.cooler.cal(tout_ch_sp, tin_ch, g_ch, tin_cd, g_cd)
        self._sync_from_cooler()

        self.heat_recovery_enabled = bool(heat_recovery_active and g_hr > 1e-9 and self.q_hr_d > 1e-9)
        self.g_hr = float(g_hr)
        self.tout_hr_sp = float(self.tout_hr_d if tout_hr_sp is None else tout_hr_sp)
        self.tin_hr = float(self.tin_hr_d if tin_hr is None else tin_hr)

        if not self.heat_recovery_enabled:
            self.q_hr = 0.0
            self.pl_hr = 0.0
            self.pw_hr = 0.0
            self.cop_hr = 0.0
            self.tout_hr = self.tout_hr_sp
            self.operating_mode = "cooling" if self.q_ch > 1e-9 else "off"
            return

        k = 1000.0 * 4.186 / 60.0
        self.tout_hr = self.tout_hr_sp
        self.q_hr = max(0.0, (self.tout_hr - self.tin_hr) * self.g_hr * k)
        if self.q_hr > self.q_hr_d:
            self.q_hr = float(self.q_hr_d)
            self.tout_hr = float(self.tin_hr + self.q_hr / max(self.g_hr * k, 1e-9))

        self.pl_hr = float(self.q_hr / max(self.q_hr_d, 1e-9))
        if self._hr_cop is not None and self.g_hr > 1e-9:
            self._hr_cop.cal(
                tout_ch_sp=self.tout_hr_sp,
                tin_ch=self.tin_hr,
                g_ch=self.g_hr,
                tin_cd=tin_cd,
                g_cd=g_cd,
            )
            self.pw_hr = float(self._hr_cop.pw)
            self.cop_hr = float(self._hr_cop.cop)
        else:
            self.pw_hr = float(self.pw_hr_d * self.pl_hr)
            self.cop_hr = float(self.q_hr / max(self.pw_hr, 1e-9))

        self.operating_mode = "simultaneous" if self.q_ch > 1e-9 else "heat_recovery"


class ParallelChillerGroup:
    """
    并联冷冻机组类

    设计目的：
    - 将“多台同型号冷冻机组（并联）”组合成一个等效对象
    - 只需要控制“组内开启台数（num_on）”，即可表示某些机组开/关
    - 便于在系统建模时减少分支数量，简化水力平衡计算

    假设与前提：
    - 组内所有机组完全同型号（同一性能表）
    - 入口工况（冷冻水/冷却水入口温度、流量）在组内均匀分配
      * 即：总流量 g_ch / g_cd 按开启台数平均分配到每台
    - 组内各机组的 COP 与出水温度差异不大，用“流量加权平均”进行汇总
    """

    def __init__(self, num_units: int, filename: str = "equipment_spec.xlsx", sheet_name: str = "Chiller"):
        if num_units < 1:
            raise ValueError("ParallelChillerGroup.num_units 必须 >= 1")

        self.num_units = num_units          # 组内总台数
        self.num_on = num_units             # 当前开启台数（可以在运行中修改）

        # 组内机组：完全同型号
        self.chillers: List[Chiller] = [Chiller(filename=filename, sheet_name=sheet_name) for _ in range(num_units)]

        # 为兼容单机 Chiller 的外部调用，暴露若干“等效参数/状态量”
        base = self.chillers[0]
        self.tout_ch_d = base.tout_ch_d
        self.tin_ch_d = base.tin_ch_d
        self.g_ch_d = base.g_ch_d * num_units  # 额定总流量 = 单机额定流量 * 台数
        self.tin_cd_d = base.tin_cd_d
        self.tout_cd_d = base.tout_cd_d
        self.g_cd_d = base.g_cd_d * num_units
        self.q_ch_d = base.q_ch_d * num_units
        self.pw_d = base.pw_d * num_units
        # 并联时定值压损：每台独立一支路，单台压损参数沿用基准机组
        self.dp_ch_d = base.dp_ch_d
        self.dp_cd_d = base.dp_cd_d

        # 以下为每时刻“等效机组”的汇总量
        self.tout_ch = base.tout_ch
        self.tout_cd = base.tout_cd
        self.tin_ch = base.tin_ch
        self.tin_cd = base.tin_cd
        self.tout_ch_sp = base.tout_ch_sp

        self.g_ch = 0.0
        self.g_cd = 0.0
        self.q_ch = 0.0
        self.pw = 0.0
        self.pl = 0.0
        self.cop = 0.0
        self.flag = 0
        self.dp_ch = 0.0
        self.dp_cd = 0.0

    def set_num_on(self, num_on: int):
        """
        设置组内当前开启台数（1 ~ num_units）
        """
        if num_on < 0:
            num_on = 0
        if num_on > self.num_units:
            num_on = self.num_units
        self.num_on = num_on

    def cal(self, tout_ch_sp: float, tin_ch: float, g_ch: float, tin_cd: float, g_cd: float):
        """
        并联冷冻机组的等效性能计算

        参数与单台 Chiller.cal 相同，但流量为“组总流量”：
            - g_ch: 冷冻水总流量 [m3/min]
            - g_cd: 冷却水总流量 [m3/min]
        """
        self.flag = 0
        self.tout_ch_sp = tout_ch_sp
        self.tin_ch = tin_ch
        self.tin_cd = tin_cd
        self.g_ch = g_ch
        self.g_cd = g_cd

        if self.num_on <= 0 or g_ch <= 0 or g_cd <= 0:
            # 全部停机或无流量：视为无负荷状态
            self.q_ch = 0.0
            self.pw = 0.0
            self.cop = 0.0
            self.pl = 0.0
            self.tout_ch = self.tin_ch
            self.tout_cd = self.tin_cd
            self.dp_ch = 0.0
            self.dp_cd = 0.0
            self.flag = 0
            return

        # 将流量按开启台数均分到每台机组
        g_ch_each = g_ch / self.num_on
        g_cd_each = g_cd / self.num_on

        # 对每台开启的机组调用单机 Chiller.cal，再做加权汇总
        q_total = 0.0
        pw_total = 0.0
        g_ch_total = 0.0
        g_cd_total = 0.0
        tout_ch_num = 0.0
        tout_cd_num = 0.0
        dp_ch_list = []
        dp_cd_list = []
        flags = []

        # 仅前 num_on 台视为运行，后面的保持停机（不参与）
        for idx, ch in enumerate(self.chillers):
            if idx < self.num_on:
                ch.cal(tout_ch_sp=tout_ch_sp, tin_ch=tin_ch, g_ch=g_ch_each, tin_cd=tin_cd, g_cd=g_cd_each)
            else:
                ch.cal(tout_ch_sp=tout_ch_sp, tin_ch=tin_ch, g_ch=0.0, tin_cd=tin_cd, g_cd=0.0)

            q_total += ch.q_ch
            pw_total += ch.pw
            g_ch_total += ch.g_ch
            g_cd_total += ch.g_cd
            tout_ch_num += ch.tout_ch * ch.g_ch
            tout_cd_num += ch.tout_cd * ch.g_cd
            dp_ch_list.append(ch.dp_ch)
            dp_cd_list.append(ch.dp_cd)
            flags.append(ch.flag)

        self.q_ch = q_total
        self.pw = pw_total
        self.g_ch = g_ch_total
        self.g_cd = g_cd_total

        if g_ch_total > 0:
            self.tout_ch = tout_ch_num / g_ch_total
        else:
            self.tout_ch = tout_ch_sp

        if g_cd_total > 0:
            self.tout_cd = tout_cd_num / g_cd_total
        else:
            self.tout_cd = tin_cd

        self.pl = self.q_ch / self.q_ch_d if self.q_ch_d > 0 else 0.0
        if self.pw > 0:
            self.cop = self.q_ch / self.pw
        else:
            self.cop = 0.0

        # 压力损失：取运行机组的典型值（并联系统下，相同机组压损相近）
        self.dp_ch = dp_ch_list[0] if dp_ch_list else 0.0
        self.dp_cd = dp_cd_list[0] if dp_cd_list else 0.0

        # 状态标志：如果任何一台有异常，则标志为异常
        self.flag = 0
        if any(f != 0 for f in flags):
            self.flag = 1


# 基于负荷率-COP 曲线的空冷 HP COP 计算（表格需按负荷率/室外干球温度递增；非水冷 Chiller 的冷却水温度轴）
# 风冷热泵机组
class AirSourceHeatPump:
    # 定格参数输入
    def __init__(self, filename='equipment_spec.xlsx', sheet_name='AirSourceHeatPump'):
        # tin   :入口温度[℃]
        # tout  :出口温度[℃]
        # g     :流量[m3/min]
        # q     : 热量[kW]
        # ch    : 冷水（chilled water）
        # d     : 定格值
        # pw    : 消耗功率[kW]
        # pl    : 部分负荷率(load factor, 0.0~1.0)
        # kr_ch : 冷水压损系数[kPa/(m3/min)**2]
        # dp    : 设备压损[kPa]
        # tdb   : 室外干球温度['C]
        spec_table = pd.read_excel(filename, sheet_name=sheet_name, header=None)
        self.tout_ch_d = float(spec_table.iat[1, 0])
        self.tin_ch_d = float(spec_table.iat[1, 1])
        self.g_ch_d = float(spec_table.iat[1, 2])
        # 定格冷冻容量[kW]
        self.q_ch_d = (self.tin_ch_d - self.tout_ch_d) * self.g_ch_d * 1000 * 4.186 / 60
        # 定格主电动机输入[kW]
        self.pw_d = float(spec_table.iat[1, 3])
        self.kr_ch = float(spec_table.iat[1, 4])
        # 辅机功率[kW]
        self.pw_sub = 0.0
        # 定格冷冻机 COP
        self.COP_rp = self.q_ch_d / self.pw_d
        # 以下为每时刻可能变化的值
        self.tout_ch = 7.0
        self.pw = 0.0
        self.q_ch = 0.0
        self.pl = 0  # 負荷率(0.0~1.0)
        self.cop = 0.0
        self.flag = 0  # 問題があったら1または2,なかったら0
        self.dp_ch = 0.0
        self.tin_ch = 12.0
        self.g_ch = 0.0
        self.tin_ch = 15.0
        self.tout_ch = 7.0
        self.tout_ch_sp = 7.0
        self.tdb = 25.0  # 希望统一该表示
        self.operating_mode = "cooling"  # cooling | heating
        self.tout_h = 45.0
        self.tin_h = 40.0
        self.tout_h_sp = 45.0
        self.g_h = 0.0
        self.q_h = 0.0

        pl_cop = spec_table.drop(spec_table.index[[0, 1, 2]])
        pl_cop.iat[0, 0] = '-'
        pl_cop = pl_cop.dropna(how='all', axis=1)
        self.data = pl_cop.values

        # 制热性能表（可选，通过 from_specs(..., heating_spec=...) 加载）
        self._heating_data = None
        self.tout_h_d = 45.0
        self.tin_h_d = 40.0
        self.g_h_d = self.g_ch_d
        self.q_h_d = 452.0
        self.pw_h_d = self.pw_d

    def _load_heating_table(self, filename: str, sheet_name: str) -> None:
        spec_table = pd.read_excel(filename, sheet_name=sheet_name, header=None)
        self.tout_h_d = float(spec_table.iat[1, 0])
        self.tin_h_d = float(spec_table.iat[1, 1])
        self.g_h_d = float(spec_table.iat[1, 2])
        self.pw_h_d = float(spec_table.iat[1, 3])
        self.q_h_d = (self.tout_h_d - self.tin_h_d) * self.g_h_d * 1000 * 4.186 / 60
        pl_cop = spec_table.drop(spec_table.index[[0, 1, 2]])
        pl_cop.iat[0, 0] = '-'
        pl_cop = pl_cop.dropna(how='all', axis=1)
        self._heating_data = pl_cop.values

    @classmethod
    def from_specs(
        cls,
        cooling_spec: dict,
        heating_spec=None,
        *,
        resolve_path=None,
    ):
        """工厂方法：制冷 sheet 必填，制热 sheet 可选。"""
        fn = str(cooling_spec.get("filename", "equipment_spec.xlsx"))
        sh = str(cooling_spec.get("sheet_name", "CoolingMode"))
        if resolve_path is not None:
            fn = str(resolve_path(fn))
        hp = cls(filename=fn, sheet_name=sh)
        if heating_spec:
            hr_fn = str(heating_spec.get("filename", fn))
            hr_sh = str(heating_spec.get("sheet_name", "HeatingMode"))
            if resolve_path is not None:
                hr_fn = str(resolve_path(hr_fn))
            hp._load_heating_table(hr_fn, hr_sh)
        return hp

    # 基于特性表计算空冷 HP 的 COP
    def cal(self, tout_ch_sp, tin_ch, g_ch, tdb):
        self.tdb = tdb
        self.flag = 0
        self.tout_ch_sp = tout_ch_sp
        self.tin_ch = tin_ch
        self.g_ch = g_ch
        # 冷水出口温度[℃]
        self.tout_ch = self.tout_ch_sp
        # 冷冻热量[kW]
        self.q_ch = (self.tin_ch - self.tout_ch) * self.g_ch * 1000 * 4.186 / 60
        # 处理热量上限取定格（负荷率上限100%），超出则提升冷水出口温度
        if self.q_ch > self.q_ch_d:
            self.tout_ch = self.tout_ch_sp + (self.q_ch - self.q_ch_d) / (self.g_ch * 1000 * 4.186 / 60)
            self.q_ch = self.q_ch_d
            self.flag = 1

        if self.q_ch > 0:
            pl = self.data[0][1:].astype(np.float32)
            temp = self.data.transpose()[0][1:].astype(np.float32)
            dataset = self.data[1:].transpose()[1:].transpose().astype(np.float32)
            cop = RegularGridInterpolator((temp, pl), dataset)

            # 部分负荷率
            self.pl = self.q_ch / self.q_ch_d
            pl_cop = self.pl

            if self.pl > pl[-1]:
                self.pl = pl[-1]
                pl_cop = self.pl
                self.q_ch = self.q_ch_d
                self.flag = 2

            elif self.pl < pl[0]:
                pl_cop = pl[0]
                self.flag = 3

            pl_lo = float(np.min(pl))
            pl_hi = float(np.max(pl))
            tin_lo = float(np.min(temp))
            tin_hi = float(np.max(temp))
            pl_cop = float(np.clip(pl_cop, pl_lo, pl_hi))
            tdb_cop = float(np.clip(float(tdb), tin_lo, tin_hi))

            self.cop = cop([[tdb_cop, pl_cop]]).item()
            # 基于逆卡诺循环按定格冷水出口温度变化校正COP
            self.cop *= ((273.15 + self.tout_ch) / (tdb - self.tout_ch)) / (
                        (273.15 + self.tout_ch_d) / (tdb - self.tout_ch_d))

            self.pw = self.q_ch / self.cop + self.pw_sub

        elif self.q_ch == 0:
            self.pw = 0
            self.cop = 0
            self.pl = 0
            self.flag = 4
        else:
            self.pw = 0
            self.cop = 0
            self.pl = 0
            self.flag = 5

        self.dp_ch = -self.kr_ch * g_ch ** 2

    def cal_heating(self, tout_h_sp, tin_h, g_h, tdb):
        """制热模式：COP 查表轴为室外干球温度 × 负荷率（需先加载制热 sheet）。"""
        self.operating_mode = "heating"
        self.tdb = tdb
        self.flag = 0
        self.tout_h_sp = float(tout_h_sp)
        self.tin_h = float(tin_h)
        self.g_h = float(g_h)
        self.tout_h = self.tout_h_sp
        k = 1000.0 * 4.186 / 60.0
        self.q_h = max(0.0, (self.tout_h - self.tin_h) * self.g_h * k)

        if self._heating_data is None:
            self.pw = 0.0
            self.cop = 0.0
            self.pl = 0.0
            self.flag = 6
            self.dp_ch = -self.kr_ch * self.g_h ** 2
            return

        if self.q_h > self.q_h_d:
            self.tout_h = self.tout_h_sp + (self.q_h - self.q_h_d) / max(self.g_h * k, 1e-9)
            self.q_h = self.q_h_d
            self.flag = 1

        if self.q_h > 0:
            pl = self._heating_data[0][1:].astype(np.float32)
            temp = self._heating_data.transpose()[0][1:].astype(np.float32)
            dataset = self._heating_data[1:].transpose()[1:].transpose().astype(np.float32)
            cop = RegularGridInterpolator((temp, pl), dataset)
            self.pl = self.q_h / max(self.q_h_d, 1e-9)
            pl_cop = float(np.clip(self.pl, float(np.min(pl)), float(np.max(pl))))
            tdb_cop = float(np.clip(float(tdb), float(np.min(temp)), float(np.max(temp))))
            self.cop = cop([[tdb_cop, pl_cop]]).item()
            if self.tout_h_sp != self.tout_h_d and abs(tdb - self.tout_h_sp) > 1e-6:
                self.cop *= ((273.15 + self.tout_h_d) / (tdb - self.tout_h_d)) / (
                    (273.15 + self.tout_h_sp) / (tdb - self.tout_h_sp)
                )
            self.pw = self.q_h / max(self.cop, 1e-9) + self.pw_sub
        else:
            self.pw = 0.0
            self.cop = 0.0
            self.pl = 0.0

        self.q_ch = 0.0
        self.g_ch = self.g_h
        self.tout_ch = self.tout_h
        self.tin_ch = self.tin_h
        self.tout_ch_sp = self.tout_h_sp
        self.dp_ch = -self.kr_ch * self.g_h ** 2


# 基于能耗基准的吸收式冷温水机模型 (Energy-Saving Standard) 
class AbsorptionChillerESS:
    # rated_capacity_c:     定额制冷能力 [kW]
    # rated_input_fuel_c:   定额制冷燃料消耗量 [Nm3]（燃料: 城市燃气）
    # power_c:              定额制冷耗电 [kW]
    # rated_capacity_h:     定额制热能力 [kW]
    # rated_input_fuel_h:   定额制热燃料消耗量 [Nm3]（燃料: 城市燃气）
    # power_h:              定额制热耗电 [kW]

    def __init__(self, rated_capacity_c, rated_input_fuel_c, power_c,
                 rated_capacity_h, rated_input_fuel_h, power_h):

        self.rated_capacity_c = rated_capacity_c
        self.rated_input_fuel_c = rated_input_fuel_c
        self.power_c = power_c
        self.rated_capacity_h = rated_capacity_h
        self.rated_input_fuel_h = rated_input_fuel_h
        self.power_h = power_h

        self.cw_c = 4.192  # 10℃水的比热, [kJ/(kg·k)]
        self.cw_h = 4.178  # 40℃水的比热, [kJ/(kg·k)]
        self.rho_c = 999.741  # 10℃水的密度, [kg/m3]
        self.rho_h = 992.210  # 40℃水的密度, [kg/m3]
        self.cg = 40.6  # 城市燃气13A低位发热量[MJ/m3N]
        self.k = 3.6  # MJ 转 kWh, [MJ/kWh]

        # 输出值
        # power_c 和 power_h 无法计算，直接输出
        self.capacity_c = 0  # 冷房能力, [kW]
        self.input_fuel_c = 0  # 制冷燃料消耗量, [Nm3]
        self.cop_c = 0  # 制冷运行COP, [-]
        self.tout_ch = 7  # 冷水出口温度, ℃

        self.capacity_h = 0  # 制热能力, [kW]
        self.input_fuel_h = 0  # 制热燃料消耗量, [Nm3]
        self.cop_h = 0  # 制热运行COP, [-]
        self.tout_h = 45  # 温水出口温度, ℃

    def cal_c(self, g, tin_cd=32, tin_ch=15, tout_ch_sp=7):
        # g:          冷水流量[m3/min]
        # tin_cd:     冷却水温度, ℃
        # tin_ch:     冷水入口温度, ℃
        # tout_ch_sp: 冷水出口温度设定值, ℃

        k_1 = 1  # 最大能力比特性
        capacity = self.rated_capacity_c * k_1  # 最大能力
        g = g * self.rho_c / 60  # 体积流量[m3/min] 转 质量流量[kg/s]
        self.capacity_c = g * (tin_ch - tout_ch_sp) * self.cw_c  # 处理的热量

        self.tout_ch = tout_ch_sp
        if self.capacity_c > self.rated_capacity_c:  # 处理热量超过定额能力时计算冷水出口温度
            delta_t = (self.capacity_c - self.rated_capacity_c) / (g * self.cw_c)
            self.tout_ch = tout_chsp + delta_t
            self.capacity_c = self.rated_capacity_c

        plr = self.capacity_c / capacity
        if plr > 1:
            plr = 1
        if plr < 0.2:
            plr = 0.2

        k_2 = 0.012333 * tin_cd + 0.605333  # 最大输入比
        k_3 = 0.167757 * plr ** 2 + 0.757814 * plr + 0.074429  # 输入比
        k_4 = -0.01276 * self.tout_ch + 1.0893  # 输入比
        self.input_fuel_c = self.rated_input_fuel_c * k_2 * k_3 * k_4  # 燃料消耗量

        q_gas = self.input_fuel_c * self.cg / self.k  # 消耗热量
        self.cop_c = self.capacity_c / (q_gas + self.power_c)

        return self.capacity_c, self.input_fuel_c, self.cop_c, self.tout_ch, self.power_c

    def cal_h(self, g, tin_h=37, tout_h_sp=45):
        # g:          温水流量[m3/min]
        # tin_h:      温水入口温度, ℃
        # tout_h_sp:  温水出口温度设定值, ℃

        k_1 = 1  # 最大能力比特性
        capacity = self.rated_capacity_h * k_1  # 最大能力

        g = g * self.rho_h / 60  # 体积流量[m3/min] 转 质量流量[kg/s]
        self.capacity_h = g * (tout_h_sp - tin_h) * self.cw_h

        self.tout_h = tout_h_sp
        if self.capacity_h > self.rated_capacity_h:
            delta_t = (self.capacity_h - self.rated_capacity_h) / (g * self.cw_h)
            self.tout_h = tout_h_sp - delta_t
            self.capacity_h = self.rated_capacity_h

        plr = self.capacity_h / capacity
        if plr > 1:
            plr = 1
        if plr < 0.1:
            plr = 0.1

        k_2 = 1
        k_3 = 1 * plr
        k_4 = 1
        self.input_fuel_h = self.rated_input_fuel_h * k_2 * k_3 * k_4
        q_gas = self.input_fuel_h * self.cg / self.k  # 消耗热量
        self.cop_h = self.capacity_h / (q_gas + self.power_h)

        return self.capacity_h, self.input_fuel_h, self.cop_h, self.tout_h, self.power_h


# 基于能耗基准的 VRF 模型 (Energy-Saving Standard)
class VariableRefrigerantFlowESS:
    def __init__(self, rated_capacity_c, rated_input_power_c, rated_capacity_h, rated_input_power_h):
        # rated_capacity_c:      定额制冷能力 [kW]
        # rated_input_power_c:   定额制冷耗电 [kW]
        # rated_capacity_h:      定额制热能力 [kW]
        # rated_input_fuel_h:    定额制热耗电 [kW]
        self.rated_capacity_c = rated_capacity_c
        self.rated_input_power_c = rated_input_power_c
        self.rated_capacity_h = rated_capacity_h
        self.rated_input_power_h = rated_input_power_h
        # 输出值
        self.capacity_c = 0
        self.input_power_c = 0
        self.cop_c = 0
        self.capacity_h = 0
        self.input_power_h = 0
        self.cop_h = 0

    # cooling mode
    def cal_c(self, odb, indoor_capacity):
        if odb < 15:  # 室外干球温度下限
            odb = 15
        if odb > 43:  # 室外干球温度上限
            odb = 43

        k_1 = -0.0025 * odb + 1.0875  # 能力比特性
        capacity_a = self.rated_capacity_c * k_1  # 该室外条件下的最大能力
        self.capacity_c = capacity_a

        cr = indoor_capacity / self.rated_capacity_c  # combination ratio: 室内机容量与室外机容量比例
        if cr < 1:
            self.capacity_c = indoor_capacity
            if capacity_a < indoor_capacity:
                self.capacity_c = capacity_a

        plr = self.capacity_c / capacity_a  # 运行部分负荷率（相对于该外气条件最大能力）
        if plr > 1:
            plr = 1
        if plr < 0.3:
            plr = 0.3

        k_2 = 0.0001212 * odb ** 2 + 0.00369 * odb + 0.72238  # 输入比特性
        k_3 = 0.8573 * plr ** 2 - 0.0456 * plr + 0.1883  # 部分负荷特性

        self.input_power_c = self.rated_input_power_c * k_2 * k_3
        self.cop_c = self.capacity_c / self.input_power_c

        return self.capacity_c, self.input_power_c, self.cop_c

    # heating mode
    def cal_h(self, owb, indoor_capacity):
        if owb < -20:  # 室外湿球温度下限
            owb = -20
        if owb > 15:  # 室外湿球温度上限
            owb = 15

        k_1 = 0  # 能力比特性
        if -20 <= owb <= -8:
            k_1 = 0.0255 * owb + 0.847
        if -8 < owb <= 4.5:
            k_1 = 0.0153 * owb + 0.762
        if 4.5 < owb <= 15:
            k_1 = 0.0255 * owb + 0.847
        capacity_a = self.rated_capacity_h * k_1
        self.capacity_h = capacity_a

        cr = indoor_capacity / self.rated_capacity_h
        if cr < 1:
            self.capacity_h = indoor_capacity
            if capacity_a < indoor_capacity:
                self.capacity_h = capacity_a

        plr = self.capacity_h / capacity_a
        if plr > 1:
            plr = 1
        if plr < 0.3:
            plr = 0.3

        k_2 = 0.0128 * owb + 0.9232  # 输入比特性
        k_3 = 0.7823 * plr ** 2 + 0.0398 * plr + 0.1779  # 部分负荷特性
        self.input_power_h = self.rated_input_power_h * k_2 * k_3
        self.cop_h = self.capacity_h / self.input_power_h

        return self.capacity_h, self.input_power_h, self.cop_h


# 基于 EnergyPlus 的 VRF 模型
# 制冷模式
class VariableRefrigerantFlowEP:
    def __init__(self, rated_capacity=31.6548, rated_input_power=9.73, length=10, height=5):

        self.rated_capacity = rated_capacity  # kW
        self.rated_input_power = rated_input_power  # kW

        self.plr_min = 0.2  # 最小运行部分负荷率 (0~0.4)

        self.length = length  # 室外机到室内机的等效管长, m
        self.height = height  # 最高与最低末端单元的高差, m
        self.indoor_capacity = 0  # kW
        self.cr = 0  # 组合比 = 额定部分负荷比

        # 用于回归分析的数据集
        boundary = pd.read_excel('equipment_spec.xlsx', sheet_name='boundary_dataset', header=None)
        boundary = boundary.drop(boundary.index[0])
        self.boundary = pd.DataFrame(boundary, dtype='float64')

        low_temp_c = pd.read_excel('equipment_spec.xlsx', sheet_name='lowt_dataset_c', header=None)
        low_temp_c = low_temp_c.drop(low_temp_c.index[0])
        self.low_temp_c = pd.DataFrame(low_temp_c, dtype='float64')

        low_temp_p = pd.read_excel('equipment_spec.xlsx', sheet_name='lowt_dataset_p', header=None)
        low_temp_p = low_temp_p.drop(low_temp_p.index[0])
        self.low_temp_p = pd.DataFrame(low_temp_p, dtype='float64')

        high_temp_c = pd.read_excel('equipment_spec.xlsx', sheet_name='hight_dataset_c', header=None)
        high_temp_c = high_temp_c.drop(high_temp_c.index[0])
        self.high_temp_c = pd.DataFrame(high_temp_c, dtype='float64')

        high_temp_p = pd.read_excel('equipment_spec.xlsx', sheet_name='hight_dataset_p', header=None)
        high_temp_p = high_temp_p.drop(high_temp_p.index[0])
        self.high_temp_p = pd.DataFrame(high_temp_p, dtype='float64')

    # 组合比修正系数
    def get_cr_correction(self):
        cr_data = pd.read_excel('equipment_spec.xlsx', sheet_name='cr_correction', header=None)
        cr_data = cr_data.drop(cr_data.index[0])
        cr_data = pd.DataFrame(cr_data, dtype='float64')

        x_data = np.array(cr_data.iloc[:, 1]).reshape(-1, 1)
        y_data = np.array(cr_data.iloc[:, 0]).reshape(-1, 1)
        model = LinearRegression()
        model.fit(x_data, y_data)
        a = model.coef_
        b = model.intercept_
        cr_correction_factor = a * self.cr + b
        cr_correction_factor = cr_correction_factor[0][0]

        if cr_correction_factor <= 1:
            return 1
        else:
            return cr_correction_factor

    # 部分负荷率的能耗比修正函数
    def get_eirfplr(self):

        if self.cr <= 1:
            eirfplr_data = pd.read_excel('equipment_spec.xlsx', sheet_name='eirfplr', header=None)
            eirfplr_data = eirfplr_data.drop(eirfplr_data.index[0])
            eirfplr_data = eirfplr_data.dropna(how='all', axis=1)
            eirfplr_data = pd.DataFrame(eirfplr_data, dtype='float64')

            x_data = eirfplr_data.iloc[:, 3:]
            y_data = eirfplr_data.iloc[:, 1]
            model = LinearRegression()
            model.fit(x_data, y_data)
            a, b, c = model.coef_
            d = model.intercept_
            eirfplr = a * self.cr + b * self.cr ** 2 + c * self.cr ** 3 + d

            return eirfplr

    # 管路长度与高度修正系数
    def get_piping_correction(self):
        pipe_data = pd.read_excel('equipment_spec.xlsx', sheet_name='piping_correction', header=None)
        pipe_data = pipe_data.drop(pipe_data.index[0])
        pipe_data = pd.DataFrame(pipe_data, dtype='float64')

        x_data = pipe_data.iloc[:, 1:]
        y_data = pipe_data.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data, y_data)
        a = model.intercept_
        b, c, d, e, f = model.coef_
        piping_correction_length = a + b * self.length + c * self.length ** 2 + d * self.cr + e * self.cr ** 2 \
                                   + f * self.length * self.cr

        piping_correction_height = 1 - 0.0019231 * self.height

        return piping_correction_length, piping_correction_height

    # 考虑管路损失的计算
    def cal_loss(self, iwb, odb, indoor_capacity):
        self.indoor_capacity = indoor_capacity
        self.cr = self.indoor_capacity / self.rated_capacity
        if self.cr > 1.5:
            self.cr = 1.5
        capacity, input_power, cop = self.cal(iwb, odb)
        piping_correction_length, piping_correction_height = self.get_piping_correction()
        # 室外机可用能力
        capacity_a = capacity * piping_correction_length * piping_correction_height

        if self.cr == 1:
            cop = capacity_a / input_power
            return capacity_a, input_power, cop

        else:
            cr_correction_factor = self.get_cr_correction()
            eirfplr = self.get_eirfplr()
            # plr: 运行部分负荷率
            plr = self.indoor_capacity / capacity_a
            cr_limit = self.plr_min * capacity_a / self.rated_capacity

            if self.cr > 1:
                capacity_h = capacity_a * cr_correction_factor
                cop = capacity_h / input_power

                return capacity_h, input_power, cop

            if cr_limit <= self.cr < 1:
                input_power_l = input_power * eirfplr
                capacity_l = self.indoor_capacity
                if self.indoor_capacity > capacity_a:  # 当 cr 接近 1（如 0.9）时可能出现
                    capacity_l = capacity_a
                cop = capacity_l / input_power_l

                return capacity_l, input_power_l, cop

            if 0 < self.cr < cr_limit:  # 等价于 plr < plr_min
                cycling_ratio = plr / self.plr_min
                cycling_ratio_fraction = 0.15 * cycling_ratio + 0.85
                rtf = cycling_ratio / cycling_ratio_fraction  # 运行时间比例

                input_power_min = input_power * eirfplr * rtf
                capacity_min = self.indoor_capacity
                cop = capacity_min / input_power_min

                return capacity_min, input_power_min, cop

    # cr≠1 情况下的计算，即 indoor_capacity ≠ rated_capacity
    def cal_pl(self, iwb, odb, indoor_capacity):
        self.indoor_capacity = indoor_capacity
        self.cr = self.indoor_capacity / self.rated_capacity
        if self.cr > 1.5:
            self.cr = 1.5  # cr 的最大值
        capacity, input_power, cop = self.cal(iwb, odb)  # 这里计算的 capacity 为可用能力
        cr_correction_factor = self.get_cr_correction()
        eirfplr = self.get_eirfplr()
        plr = self.indoor_capacity / capacity  # 运行部分负荷率
        # 因为 self.cr = indoor_capacity / rated_capacity，plr = rated_capacity / capacity * self.cr
        # 即 self.cr = plr * capacity / rated_capacity
        cr_limit = self.plr_min * capacity / self.rated_capacity  # 由 plr 与 cr 的关系得出

        if self.cr >= 1:
            capacity_h = capacity * cr_correction_factor
            cop = capacity_h / input_power

            return capacity_h, input_power, cop

        if cr_limit <= self.cr < 1:
            input_power_l = input_power * eirfplr
            capacity_l = self.indoor_capacity
            if self.indoor_capacity > capacity:  # 当 cr 接近 1（如 0.9）时可能出现
                capacity_l = capacity
            cop = capacity_l / input_power_l

            return capacity_l, input_power_l, cop

        if 0 < self.cr < cr_limit:  # 等价于 plr < plr_min
            cycling_ratio = plr / self.plr_min
            cycling_ratio_fraction = 0.15 * cycling_ratio + 0.85
            rtf = cycling_ratio / cycling_ratio_fraction  # 运行时间比例

            input_power_min = input_power * eirfplr * rtf
            capacity_min = self.indoor_capacity
            cop = capacity_min / input_power_min

            return capacity_min, input_power_min, cop

    # cr=1 情况下的计算
    def cal(self, iwb, odb):
        # 制冷能力比边界性能曲线的回归分析
        x_data_b = self.boundary.iloc[:, 1:]
        y_data_b = self.boundary.iloc[:, 0]
        model_b = LinearRegression()
        model_b.fit(x_data_b, y_data_b)
        a = model_b.intercept_
        b, c = model_b.coef_
        odb_boundary = a + b * iwb + c * iwb ** 2

        # 若输入的室外干球温度低于计算得到的 odb_boundary，则使用低温区域性能曲线；否则使用高温区域性能曲线
        if odb <= odb_boundary:
            # 低温区域制冷能力比修正函数的回归分析
            x_data_c = self.low_temp_c.iloc[:, 1:]
            y_data_c = self.low_temp_c.iloc[:, 0]
            model_c = LinearRegression()
            model_c.fit(x_data_c, y_data_c)
            intercept_c = model_c.intercept_
            coef_c = model_c.coef_
            capft = intercept_c + coef_c[0] * iwb + coef_c[1] * iwb ** 2 \
                    + coef_c[2] * odb + coef_c[3] * odb ** 2 + coef_c[4] * iwb * odb

            capacity = self.rated_capacity * capft

            # 低温区域输入功率比修正函数的回归分析
            x_data_p = self.low_temp_p.iloc[:, 3:]
            y_data_p = self.low_temp_p.iloc[:, 2]
            model_p = LinearRegression()
            model_p.fit(x_data_p, y_data_p)
            intercept_p = model_p.intercept_
            coef_p = model_p.coef_
            eirft = intercept_p + coef_p[0] * iwb + coef_p[1] * iwb ** 2 \
                    + coef_p[2] * odb + coef_p[3] * odb ** 2 + coef_p[4] * iwb * odb
            power_ratio = eirft * capft

            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop

        else:
            # 高温区域制冷能力比修正函数的回归分析
            x_data_c = self.high_temp_c.iloc[:, 1:]
            y_data_c = self.high_temp_c.iloc[:, 0]
            model_c = LinearRegression()
            model_c.fit(x_data_c, y_data_c)
            intercept_c = model_c.intercept_
            coef_c = model_c.coef_
            capft = intercept_c + coef_c[0] * iwb + coef_c[1] * iwb ** 2 \
                    + coef_c[2] * odb + coef_c[3] * odb ** 2 + coef_c[4] * iwb * odb

            capacity = self.rated_capacity * capft

            # 高温区域输入功率比修正函数的回归分析
            x_data_p = self.high_temp_p.iloc[:, 3:]
            y_data_p = self.high_temp_p.iloc[:, 2]
            model_p = LinearRegression()
            model_p.fit(x_data_p, y_data_p)
            intercept_p = model_p.intercept_
            coef_p = model_p.coef_
            eirft = intercept_p + coef_p[0] * iwb + coef_p[1] * iwb ** 2 \
                    + coef_p[2] * odb + coef_p[3] * odb ** 2 + coef_p[4] * iwb * odb
            power_ratio = eirft * capft

            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop


# 供暖模式
class VRFEPHeatingMode:
    def __init__(self, rated_capacity=37.5, rated_input_power=10.59, length=10, height=5):

        self.rated_capacity = rated_capacity  # kW
        self.rated_input_power = rated_input_power  # kW

        self.indoor_capacity = 0
        self.cr = 0  # 组合比
        self.plr_min = 0.2  # 最小部分负荷率

        self.length = length  # 室外机到室内机的等效管长, m
        self.height = height  # 最高与最低末端单元的高差, m

        # 回归分析用数据集
        boundary_c = pd.read_excel('equipment_spec.xlsx', sheet_name='boundary_dataset_c', header=None)
        boundary_c = boundary_c.drop(boundary_c.index[0])
        self.boundary_c = pd.DataFrame(boundary_c, dtype='float64')

        boundary_p = pd.read_excel('equipment_spec.xlsx', sheet_name='boundary_dataset_p', header=None)
        boundary_p = boundary_p.drop(boundary_p.index[0])
        self.boundary_p = pd.DataFrame(boundary_p, dtype='float64')

        low_temp_c = pd.read_excel('equipment_spec.xlsx', sheet_name='lowt_dataset_c_h', header=None)
        low_temp_c = low_temp_c.drop(low_temp_c.index[0])
        self.low_temp_c = pd.DataFrame(low_temp_c, dtype='float64')

        low_temp_p = pd.read_excel('equipment_spec.xlsx', sheet_name='lowt_dataset_p_h', header=None)
        low_temp_p = low_temp_p.drop(low_temp_p.index[0])
        self.low_temp_p = pd.DataFrame(low_temp_p, dtype='float64')

        high_temp_c = pd.read_excel('equipment_spec.xlsx', sheet_name='hight_dataset_c_h', header=None)
        high_temp_c = high_temp_c.drop(high_temp_c.index[0])
        self.high_temp_c = pd.DataFrame(high_temp_c, dtype='float64')

        high_temp_p = pd.read_excel('equipment_spec.xlsx', sheet_name='hight_dataset_p_h', header=None)
        high_temp_p = high_temp_p.drop(high_temp_p.index[0])
        self.high_temp_p = pd.DataFrame(high_temp_p, dtype='float64')

    # 组合比修正系数
    def get_cr_correction(self):
        cr_data = pd.read_excel('equipment_spec.xlsx', sheet_name='cr_correction_h', header=None)
        cr_data = cr_data.drop(cr_data.index[0])
        cr_data = pd.DataFrame(cr_data, dtype='float64')

        x_data = cr_data.iloc[:, 1:]
        y_data = cr_data.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data, y_data)
        a = model.intercept_
        b, c, d = model.coef_
        cr_correction_factor = a + b * self.cr + c * self.cr ** 2 + d * self.cr ** 3

        if cr_correction_factor <= 1:
            return 1
        else:
            return cr_correction_factor

    # 部分负荷率的能耗比修正函数
    def get_eirfplr(self):

        if self.cr <= 1:
            eirfplr_l = pd.read_excel('equipment_spec.xlsx', sheet_name='eirfplr_l', header=None)
            eirfplr_l = eirfplr_l.drop(eirfplr_l.index[0])
            eirfplr_l = eirfplr_l.dropna(how='all', axis=1)
            eirfplr_l = pd.DataFrame(eirfplr_l, dtype='float64')

            x_data = eirfplr_l.iloc[:, 3:]
            y_data = eirfplr_l.iloc[:, 1]
            model = LinearRegression()
            model.fit(x_data, y_data)
            a = model.intercept_
            b, c, d = model.coef_
            eirfplr = a + b * self.cr + c * self.cr ** 2 + d * self.cr ** 3

            return eirfplr

        if self.cr > 1:
            eirfplr_h = pd.read_excel('equipment_spec.xlsx', sheet_name='eirfplr_h', header=None)
            eirfplr_h = eirfplr_h.drop(eirfplr_h.index[0])
            eirfplr_h = eirfplr_h.dropna(how='all', axis=1)
            eirfplr_h = pd.DataFrame(eirfplr_h, dtype='float64')

            x_data = eirfplr_h.iloc[:, 3:]
            y_data = eirfplr_h.iloc[:, 1]
            model = LinearRegression()
            model.fit(x_data, y_data)
            a, b, c = model.coef_
            d = model.intercept_
            eirfplr = a + b * self.cr + c * self.cr ** 2 + d * self.cr ** 3

            return eirfplr

    # 管路长度与高度修正系数
    def get_piping_correction(self):
        pipe_data = pd.read_excel('equipment_spec.xlsx', sheet_name='piping_correction_h', header=None)
        pipe_data = pipe_data.drop(pipe_data.index[0])
        pipe_data = pd.DataFrame(pipe_data, dtype='float64')

        x_data = pipe_data.iloc[:, 1:]
        y_data = pipe_data.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data, y_data)
        a = model.intercept_
        b, c, d = model.coef_
        piping_correction_length = a + b * self.length + c * self.length ** 2 + d * self.length ** 3

        piping_correction_height = 0

        piping_correction = piping_correction_length + piping_correction_height

        return piping_correction

    def get_defrost_correction(self, owb):
        # 室外湿球温度可用范围
        if owb < -10:
            owb = -10
        if owb > 5.84:
            owb = 5.84

        df_data = pd.read_excel('equipment_spec.xlsx', sheet_name='df_correction', header=None)
        df_data = df_data.drop(df_data.index[0])
        df_data = pd.DataFrame(df_data, dtype='float64')

        x_data = df_data.iloc[:, 1:]
        y_data = df_data.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data, y_data)
        a = model.intercept_
        b, c, d = model.coef_
        defrost_correction = a + b * owb + c * owb ** 2 + d * owb ** 3

        return defrost_correction

    # 考虑管路损失和除霜修正的计算
    def cal_loss(self, idb, owb, indoor_capacity):
        self.indoor_capacity = indoor_capacity
        self.cr = self.indoor_capacity / self.rated_capacity
        if self.cr > 1.5:
            self.cr = 1.5
        piping_correction = self.get_piping_correction()
        defrost_correction = self.get_defrost_correction(owb=owb)

        capacity, input_power, cop = self.cal(idb, owb)
        capacity_a = capacity * defrost_correction * piping_correction

        if self.cr == 1:
            cop = capacity_a / input_power

            return capacity_a, input_power, cop
        else:
            cr_correction_factor = self.get_cr_correction()
            eirfplr = self.get_eirfplr()
            plr = self.indoor_capacity / capacity_a
            cr_limit = self.plr_min * capacity_a / self.rated_capacity

            if self.cr > 1:
                capacity_h = capacity_a * cr_correction_factor
                cop = capacity_h / input_power

                return capacity_h, input_power, cop

            if cr_limit <= self.cr < 1:
                input_power_l = input_power * eirfplr
                capacity_l = self.indoor_capacity
                if self.indoor_capacity > capacity_a:  # 当 cr 接近 1（如 0.9）时可能出现
                    capacity_l = capacity_a
                cop = capacity_l / input_power_l

                return capacity_l, input_power_l, cop

            if 0 < self.cr < cr_limit:  # 等价于 plr < plr_min
                cycling_ratio = plr / self.plr_min
                cycling_ratio_fraction = 0.15 * cycling_ratio + 0.85
                rtf = cycling_ratio / cycling_ratio_fraction  # 运行时间比例

                input_power_min = input_power * eirfplr * rtf
                capacity_min = self.indoor_capacity
                cop = capacity_min / input_power_min

                return capacity_min, input_power_min, cop

    # cr≠1 情况下的计算，即额定室内能力 ≠ 额定能力
    def cal_pl(self, idb, owb, indoor_capacity):
        self.indoor_capacity = indoor_capacity
        self.cr = self.indoor_capacity / self.rated_capacity
        if self.cr > 1.5:
            self.cr = 1.5
        capacity, input_power, cop = self.cal(idb, owb)
        cr_correction_factor = self.get_cr_correction()
        eirfplr = self.get_eirfplr()
        plr = self.indoor_capacity / capacity
        cr_limit = self.plr_min * capacity / self.rated_capacity

        if self.cr >= 1:
            capacity_h = capacity * cr_correction_factor
            cop = capacity_h / input_power

            return capacity_h, input_power, cop

        if cr_limit <= self.cr < 1:
            input_power_l = input_power * eirfplr
            capacity_l = self.indoor_capacity
            if self.indoor_capacity > capacity:  # 当 cr 接近 1（如 0.9）时可能出现
                capacity_l = capacity
            cop = capacity_l / input_power_l

            return capacity_l, input_power_l, cop

        if 0 < self.cr < cr_limit:
            cycling_ratio = plr / self.plr_min
            cycling_ratio_fraction = 0.15 * cycling_ratio + 0.85
            rtf = cycling_ratio / cycling_ratio_fraction  # 运行时间比例

            input_power_min = input_power * eirfplr * rtf
            capacity_min = self.indoor_capacity
            cop = capacity_min / input_power_min

            return capacity_min, input_power_min, cop

    # cr==1 情况下的计算
    def cal(self, idb, owb):
        # 供暖能力比边界性能曲线的回归分析
        x_data_c = self.boundary_c.iloc[:, 1:]
        y_data_c = self.boundary_c.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data_c, y_data_c)
        ac = model.intercept_
        bc, cc = model.coef_
        boundary_c = ac + bc * idb + cc * idb ** 2

        # 供暖输入功率边界性能曲线的回归分析
        x_data_p = self.boundary_p.iloc[:, 1:]
        y_data_p = self.boundary_p.iloc[:, 0]
        model = LinearRegression()
        model.fit(x_data_p, y_data_p)
        ap = model.intercept_
        bp, cp = model.coef_
        boundary_p = ap + bp * idb + cp * idb ** 2

        # 低温区域供暖能力比修正函数的回归分析
        x_data_c_l = self.low_temp_c.iloc[:, 1:]
        y_data_c_l = self.low_temp_c.iloc[:, 0]
        model_c = LinearRegression()
        model_c.fit(x_data_c_l, y_data_c_l)
        al = model_c.intercept_
        bl, cl, dl, el, fl = model_c.coef_
        capft_l = al + bl * idb + cl * idb ** 2 + dl * owb + el * owb ** 2 + fl * idb * owb

        # 高温区域供暖能力比修正函数的回归分析
        x_data_c_h = self.high_temp_c.iloc[:, 1:]
        y_data_c_h = self.high_temp_c.iloc[:, 0]
        model_c_h = LinearRegression()
        model_c_h.fit(x_data_c_h, y_data_c_h)
        ah = model_c_h.intercept_
        bh, ch, dh, eh, fh = model_c_h.coef_
        capft_h = ah + bh * idb + ch * idb ** 2 + dh * owb + eh * owb ** 2 + fh * idb * owb

        # 低温区域输入功率比修正函数的回归分析
        x_data_p_l = self.low_temp_p.iloc[:, 3:]
        y_data_p_l = self.low_temp_p.iloc[:, 2]
        model_p_l = LinearRegression()
        model_p_l.fit(x_data_p_l, y_data_p_l)
        gl = model_p_l.intercept_
        hl, il, jl, kl, ll = model_p_l.coef_
        eirft_l = gl + hl * idb + il * idb ** 2 + jl * owb + kl * owb ** 2 + ll * idb * owb

        # 高温区域输入功率比修正函数的回归分析
        x_data_p_h = self.high_temp_p.iloc[:, 3:]
        y_data_p_h = self.high_temp_p.iloc[:, 2]
        model_p_h = LinearRegression()
        model_p_h.fit(x_data_p_h, y_data_p_h)
        gh = model_p_h.intercept_
        hh, ih, jh, kh, lh = model_p_h.coef_
        eirft_h = gh + hh * idb + ih * idb ** 2 + jh * owb + kh * owb ** 2 + lh * idb * owb

        # 若输入室外湿球温度低于计算得到的边界 owb，则使用低温区域性能曲线；否则使用高温区域性能曲线
        if owb <= boundary_c and owb <= boundary_p:
            capacity = self.rated_capacity * capft_l
            power_ratio = eirft_l * capft_l
            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop

        if owb > boundary_c and owb > boundary_p:
            capacity = self.rated_capacity * capft_h
            power_ratio = eirft_h * capft_h
            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop

        if boundary_c > owb > boundary_p:
            capacity = self.rated_capacity * capft_l
            power_ratio = eirft_h * capft_l
            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop

        if boundary_c < owb < boundary_p:
            capacity = self.rated_capacity * capft_h
            power_ratio = eirft_l * capft_h
            input_power = self.rated_input_power * power_ratio
            cop = capacity / input_power

            return capacity, input_power, cop


class GeoThermalHeatPump_LCEM:
    def __init__(self,
                 temp_c: float = 7.0,  # 摄氏度
                 temp_h: float = 45.0,  # 摄氏度
                 rank_c: int = 1,
                 rank_h: int = 1,
                 rated_cap_c: float = 53.0,
                 rated_cap_h: float = 61.0,
                 rated_flow_c: float = 153.0,  # L/min
                 rated_flow_h: float = 167.0,  # L/min
                 rated_flow_cd_c: float = 183.0,  # L/min
                 rated_flow_cd_h: float = 133.0,  # L/min
                 rated_power_c: float = 10.8,  # kW
                 rated_power_h: float = 15.2,  # kW
                 rated_freq: float = 50.0,  # Hz
                 coefficient_ele_a: float = 1.0,
                 coefficient_ele_b: float = 0.0,
                 mod_temp_chs: float = 0.01,
                 ):
        self.temp_c = temp_c
        self.temp_h = temp_h
        self.rank_c = rank_c
        self.rank_h = rank_h
        self.rated_cap_c = rated_cap_c
        self.rated_cap_h = rated_cap_h
        self.rated_flow_c = rated_flow_c
        self.rated_flow_h = rated_flow_h
        self.rated_flow_cd_c = rated_flow_cd_c
        self.rated_flow_cd_h = rated_flow_cd_h
        self.rated_power_c = rated_power_c
        self.rated_power_h = rated_power_h
        self.rated_freq = rated_freq
        self.coefficient_ele_a = coefficient_ele_a
        self.coefficient_ele_b = coefficient_ele_b
        self.mod_temp_chs = mod_temp_chs

    def get_config(self):
        config = {"temp_c": self.temp_c,
                  "temp_h": self.temp_h,
                  "rank_c": self.rank_c,
                  "rank_h": self.rank_h,
                  "rated_cap_c": self.rated_cap_c,
                  "rated_cap_h": self.rated_cap_h,
                  "rated_flow_c": self.rated_flow_c,
                  "rated_flow_h": self.rated_flow_h,
                  "rated_flow_cd_c": self.rated_flow_cd_c,
                  "rated_flow_cd_h": self.rated_flow_cd_h,
                  "rated_power_c": self.rated_power_c,
                  "rated_power_h": self.rated_power_h,
                  "rated_freq": self.rated_freq,
                  "coefficient_ele_a": self.coefficient_ele_a,
                  "coefficient_ele_b": self.coefficient_ele_b,
                  "mod_temp_chs": self.mod_temp_chs,
                  }
        return config

    def set_config(self,
                   temp_c: float = None,  # 摄氏度
                   temp_h: float = None,  # 摄氏度
                   rank_c: int = None,
                   rank_h: int = None,
                   rated_cap_c: float = None,  # kW
                   rated_cap_h: float = None,  # kW
                   rated_flow_c: float = None,  # L/min
                   rated_flow_h: float = None,  # L/min
                   rated_flow_cd_c: float = None,  # L/min
                   rated_flow_cd_h: float = None,  # L/min
                   rated_power_c: float = None,  # kW
                   rated_power_h: float = None,  # kW
                   coefficient_ele_a: float = None,
                   coefficient_ele_b: float = None,
                   mod_temp_chs: float = None,
                   ):
        if not temp_c is None:
            self.temp_c = temp_c
        if not temp_h is None:
            self.temp_h = temp_h
        if not rank_c is None:
            self.rank_c = rank_c
        if not rank_h is None:
            self.rank_h = rank_h
        if not rated_cap_c is None:
            self.rated_cap_c = rated_cap_c
        if not rated_cap_h is None:
            self.rated_cap_h = rated_cap_h
        if not rated_flow_c is None:
            self.rated_flow_c = rated_flow_c
        if not rated_flow_h is None:
            self.rated_flow_h = rated_flow_h
        if not rated_flow_cd_c is None:
            self.rated_flow_cd_c = rated_flow_cd_c
        if not rated_flow_cd_h is None:
            self.rated_flow_cd_h = rated_flow_cd_h
        if not rated_power_c is None:
            self.rated_power_c = rated_power_c
        if not rated_power_h is None:
            self.rated_power_h = rated_power_h
        if not rated_freq is None:
            self.rated_freq = rated_freq
        if not coefficient_ele_a is None:
            self.coefficient_ele_a = coefficient_ele_a
        if not coefficient_ele_b is None:
            self.coefficient_ele_b = coefficient_ele_b
        if not mod_temp_chs is None:
            self.mod_temp_chs = mod_temp_chs

    def run(self,
            state: int,  # 0:停止, 1:运行
            mode: int,  # 0:停止, 1:制冷, 2:制热
            flow_ch: float,  # L/min
            temp_chr: float,  # 摄氏度
            flow_cd: float,  # L/min
            temp_cds: float,  # 摄氏度
            ):
        error = 0
        # 计算设定出口温度
        if mode == 2:
            tmp_temp_chs = float(self.temp_h)
        else:
            tmp_temp_chs = float(self.temp_c)

        # 计算
        if state * mode == 0:
            work_ch = 0.0
            upper_work_ch = 0.0
            full_power = 0.0
            full_cop = 0.0
            plr = 0.0
            mod_plr = 0.0
        else:
            if mode == 1:
                work_ch = self.rated_cap_c
            else:
                work_ch = self.rated_cap_h
            upper_work_ch = 0.0

            if mode == 1:
                temp1 = self.temp_c * 2
                temp2 = 0.0
            else:
                temp1 = self.temp_h * 2
                temp2 = 0.0

            while work_ch > upper_work_ch * 1.05:
                self.upper_work_ch = upper_work_ch
                self.temp_chs = tmp_temp_chs
                self.work_ch = work_ch

                work_ch = abs(tmp_temp_chs - temp_chr) * flow_ch * 60 / 860  # kW
                if mode == 1:
                    if self.rated_freq == 50.0:
                        upper_work_ch = 0.02251 * tmp_temp_chs ** 2 + (-0.01407) * tmp_temp_chs * temp_cds + (
                            -0.00126) * temp_cds ** 2 + 1.738 * tmp_temp_chs + (-0.305) * temp_cds + 51.32
                        full_power = (-0.001418) * tmp_temp_chs ** 2 + 0.005793 * tmp_temp_chs * temp_cds + (
                            -0.0001034) * temp_cds ** 2 + (-0.1244) * tmp_temp_chs + 0.2912 * temp_cds + 3.218
                    else:
                        upper_work_ch = 0.02386 * tmp_temp_chs ** 2 + (-0.0165) * tmp_temp_chs * temp_cds + (
                            -0.001652) * temp_cds ** 2 + 1.997 * tmp_temp_chs + (-0.3499) * temp_cds + 60.22
                        full_power = (
                                         -0.0006445) * tmp_temp_chs ** 2 + 0.006063 * tmp_temp_chs * temp_cds + 0.0004485 * temp_cds ** 2 + (
                                         -0.1096) * tmp_temp_chs + 0.319 * temp_cds + 4.412
                    upper_work_ch = upper_work_ch / 53.0 * self.rated_cap_c
                    full_power = full_power / 10.8 * self.rated_power_c

                else:
                    if self.rated_freq == 50.0:
                        upper_work_ch = (-0.001352) * tmp_temp_chs ** 2 + (
                            -0.008325) * tmp_temp_chs * temp_cds + 0.02112 * temp_cds ** 2 + 0.03779 * tmp_temp_chs + 1.445 * temp_cds + 46.62
                        full_power = (-0.0001136) * tmp_temp_chs ** 2 + 0.005796 * tmp_temp_chs * temp_cds + (
                            -0.001418) * temp_cds ** 2 + 0.264 * tmp_temp_chs + (-0.1393) * temp_cds + 2.48
                    else:
                        upper_work_ch = (-0.001202) * tmp_temp_chs ** 2 + (
                            -0.01049) * tmp_temp_chs * temp_cds + 0.02322 * temp_cds ** 2 + 0.02972 * tmp_temp_chs + 1.709 * temp_cds + 55.42
                        full_power = 0.0004311 * tmp_temp_chs ** 2 + 0.006065 * tmp_temp_chs * temp_cds + (
                            -0.0006446) * temp_cds ** 2 + 0.28542 * tmp_temp_chs + (-0.1335) * temp_cds + 3.489
                    upper_work_ch = upper_work_ch / 61.0 * self.rated_cap_h
                    full_power = full_power / 15.2 * self.rated_power_c
                full_cop = upper_work_ch / full_power

                if work_ch > upper_work_ch * 1.05:
                    if mode == 1:
                        tmp_temp_chs += self.mod_temp_chs
                    else:
                        tmp_temp_chs -= self.mod_temp_chs

            plr = work_ch / upper_work_ch
            mod_plr = max(0.3, plr)

        if state * mode == 0:
            rate_power = 0.0
            power = 0.0
            cop = 0.0
            temp_cdr = temp_cds
            if mode == 1:
                work_c = work_ch
                work_h = 0.0
            else:
                work_c = 0.0
                work_h = work_ch

        else:
            if mode == 1:
                if self.rated_freq == 50.0:
                    rate_power = 4.899 * mod_plr ** 4 + (-12.81) * mod_plr ** 3 + 12.05 * mod_plr ** 2 + (
                        -3.792) * mod_plr + 0.6557
                else:
                    rate_power = (-1.304) * mod_plr ** 4 + 4.172 * mod_plr ** 3 + (
                        -4.376) * mod_plr ** 2 + 2.747 * mod_plr + (-0.2371)
            else:
                if self.rated_freq == 50.0:
                    rate_power = 1.804 * mod_plr ** 4 + (-4.428) * mod_plr ** 3 + 3.858 * mod_plr ** 2 + (
                        -0.4286) * mod_plr + 0.1962
                else:
                    rate_power = (-0.3699) * mod_plr ** 4 + 1.255 * mod_plr ** 3 + (
                        -1.309) * mod_plr ** 2 + 1.477 * mod_plr + (-0.04922)
            if work_ch == 0.0:
                power = 0.0
                cop = 0.0
            else:
                power = max(0, self.coefficient_ele_a * full_power * rate_power + self.coefficient_ele_b)  # kW
                cop = work_ch / power
            if flow_ch == 0:
                temp_cdr = temp_cds
            else:
                if mode == 1:
                    temp_cdr = temp_cds + (work_ch + power) * 860 / 60 / flow_cd
                else:
                    temp_cdr = temp_cds + (-work_ch + power) * 860 / 60 / flow_cd
            if mode == 1:
                work_c = work_ch
                work_h = 0.0
            else:
                work_c = 0.0
                work_h = work_ch

        # print(upper_work_ch, work_ch, temp_cdr, temp_cds, tmp_temp_chs)
        # print(upper_work_ch, work_ch, plr)
        # result
        res = {"temp_chs": tmp_temp_chs,
               "temp_cdr": temp_cdr,
               "flow_cd": flow_cd,
               "cooling": work_c,
               "heating": work_h,
               "PLR": mod_plr,
               "COP": cop,
               "power": power,
               "gas": 0.0,
               "error": error,
               }
        return res


# 冷却塔
class CoolingTower:
    def __init__(self, tin_w_d=36.0, tout_w_d=31.0, twb_d=28.0, g_w_d=6, g_a_d=123.0, pw_d=11, actual_head=2.0, kr=1.0):
        # ua        : UA 值（换热面积[m2] × 传热系数[W/(m2·℃)]）
        # g_w       : 冷却水流量[kg/s]
        # g_a       : 风量[kg/s]
        # tin_w     : 冷却水入口温度[℃]
        # tdb       :（外气）干球温度[℃]
        # rh        :（外气）相对湿度(0~100)
        # inv       : 风机变频比（0.0~1.0）
        # flag      : 收敛计算的标志
        # actual head: 实际扬程 [m]
        # g_a_d     : 定额风量 [m3/min]
        # pw_d      : 定额耗电 [kW]
        # 设计工况（额定值）
        # tin_w_d=37.0    # 设计进水温度（从冷水机组来的热水）
        # tout_w_d=32.0   # 设计出水温度（送回去的冷水）
        # twb_d=27.0      # 设计湿球温度（夏天最热时的空气湿度）
        # g_w_d=0.26      # 设计冷却水流量 [m³/min]（约15.6 m³/h）
        # g_a_d=123.0     # 设计风量 [m³/min]（风机能力）
        # pw_d=2.4        # 设计风机功率 [kW]
        # actual_head=2.0 # 实际扬程 [m]（水泵要克服的高度）
        # kr=1.0          # 阻力系数 [kPa/(m³/min)²]
        self.kr = kr
        self.g_w = 0
        self.tin_w = 15.0
        self.tou_w = 15.0
        self.g_a = 0
        self.tdb = 15
        self.rh = 50
        self.inv = 1.0
        self.flag = 0
        self.pw = 0
        self.dp = 0
        self.tout_w = 15
        self.actual_head = actual_head
        self.g_a_d = g_a_d
        self.pw_d = pw_d
        self.tin_w_d = tin_w_d
        self.tout_w_d = tout_w_d
        self.twb_d = twb_d
        self.g_w_d = g_w_d

        # U A 值的搜索
        ua_min = 0.1
        ua_max = 9999999999
        tout_w0 = self.tout_w_d + 1
        cnt = 0
        while abs(tout_w0 - self.tout_w_d) > 0.001:
            self.ua = (ua_min + ua_max)/2
            tout_w0 = self.cal(self.g_w_d, self.tin_w_d, self.twb_d, 100)
            if tout_w0 - self.tout_w_d > 0:
                ua_min = self.ua
            else:
                ua_max = self.ua
            cnt += 1
            if cnt == 100:
                print("冷却塔的 UA 值未正确校准")
                break

        self.inv = 0.0  # 初始值设为 0

    def cal(self, g_w, tin_w, tdb, rh):
        # cpw       : 冷却水比热 [J/kg·℃]
        # cp        : 湿空气（外气）比热 [J/kg·℃]
        self.g_w = g_w
        self.tdb = tdb
        self.rh = rh
        self.tin_w = tin_w
        self.g_a = self.inv * self.g_a_d  # [m3/min]
        self.pw = self.pw_d * self.inv ** 3  # [kW] 基于三次方则计算

        if self.g_a < 10:  # 自然风
            self.g_a = 10

        # 单位换算([m3/min] -> [kg/s])
        g_w = self.g_w * 10 ** 3 / 60
        g_a = self.g_a * 1.293 / 60
        cpw = 4184
        cp = 1100

        if g_w > 0:

            # 由干球温度与湿球温度求外气比焓
            [hin, xin] = tdb_rh2h_x(tdb, rh)
            twbin = tdb_rh2twb(tdb, rh)

            # 求湿球温度下饱和空气的比焓
            # 空气出口湿球温度的最大/最小值
            twboutmax = max(self.tin_w, twbin)
            twboutmin = min(self.tin_w, twbin)

            # 收敛计算的初始值设定
            twbout0 = 1
            twbout = 0
            cnt = 0
            q = 0.0
            cw = 0.0
            self.flag = 0

            while (twbout0 - twbout < - 0.01) or (twbout0 - twbout > 0.01):

                # 假定空气出口湿球温度
                twbout0 = (twboutmax + twboutmin) / 2
                # 入口空气按饱和空气假定，求出口空气比焓
                [hout, xout] = tdb_rh2h_x(twbout0, 100)

                # 计算空气平均比热 cpe
                dh = (hout - hin) * 1000  # 比焓单位换算为 J/kg
                dtwb = twbout0 - twbin
                cpe = dh / dtwb

                ua_e = self.ua * cpe / cp

                cw = g_w * cpw
                ca = g_a * cpe
                cmin = min(cw, ca)
                cmax = max(cw, ca)
                if cmin == 0:  # 防止为 0
                    cmin = 0.001
                if cmax == 0:
                    cmax = 0.001

                ntu = ua_e / cmin

                eps = (1 - math.exp(-ntu * (1 - cmin / cmax))) / (1 - cmin / cmax * math.exp(-ntu * (1 - cmin / cmax)))

                q = eps * cmin * (self.tin_w - twbin)

                twbout = twbin + q / ca
                if twbout < twbout0:
                    twboutmax = twbout0
                else:
                    twboutmin = twbout0

                cnt += 1
                if cnt > 30:
                    self.flag = 1
                    break

            self.tout_w = self.tin_w - q / cw

        self.dp = -self.kr * self.g_w ** 2

        return self.tout_w

    def f2p(self, g_w):
        self.g_w = g_w
        self.dp = -self.kr * self.g_w ** 2 - 9.8*self.actual_head  # 实际扬程 mAq->kPa 转换
        return self.dp

    def f2p_co(self):
        return [- 9.8*self.actual_head, 0, -self.kr]


# 冷却塔组类 - 支持多台冷却塔，每台独立控制风扇
class CoolingTowerBank:
    """
    冷却塔组类
    管理多台冷却塔，每台冷却塔可以独立控制风扇开启/关闭
    冷却水流量按比例分配到各台冷却塔，出口温度按流量加权平均
    
    特性：
    - 冷却塔关闭（g_w=0）→ 所有风扇一定关闭
    - 冷却塔开启（g_w>0）→ 每台风扇可以独立开启/关闭
    """
    def __init__(self, num_towers=12, tin_w_d=36.0, tout_w_d=31.0, twb_d=28.0, 
                 g_w_d_per_tower=6, g_a_d_per_tower=2900, pw_d_per_tower=11, 
                 actual_head=2.0, kr_per_tower=1.0):
        """
        初始化冷却塔组
        
        Args:
            num_towers: 冷却塔数量
            tin_w_d: 设计进水温度 [℃]
            tout_w_d: 设计出水温度 [℃]
            twb_d: 设计湿球温度 [℃]
            g_w_d_per_tower: 单台设计冷却水流量 [m³/min]
            g_a_d_per_tower: 单台设计风量 [m³/min]
            pw_d_per_tower: 单台设计功率 [kW]
            actual_head: 实际扬程 [m]
            kr_per_tower: 单台阻力系数 [kPa/(m³/min)²]
        """
        self.num_towers = num_towers
        self.towers = []
        
        # 创建多台冷却塔实例
        for i in range(num_towers):
            tower = CoolingTower(
                tin_w_d=tin_w_d,
                tout_w_d=tout_w_d,
                twb_d=twb_d,
                g_w_d=g_w_d_per_tower,
                g_a_d=g_a_d_per_tower,
                pw_d=pw_d_per_tower,
                actual_head=actual_head,
                kr=kr_per_tower
            )
            self.towers.append(tower)
        
        # 总设计参数（用于兼容性）
        self.g_w_d = g_w_d_per_tower * num_towers
        self.g_a_d = g_a_d_per_tower * num_towers
        self.pw_d = pw_d_per_tower * num_towers
        self.kr = kr_per_tower / num_towers  # 并联时总阻力降低
        self.actual_head = actual_head
        
        # 当前状态（汇总值）
        self.g_w = 0
        self.tin_w = 15.0
        self.tout_w = 15.0
        self.g_a = 0
        self.tdb = 15
        self.rh = 50
        self.inv = 0.0  # 平均变频比（用于兼容性）
        self.pw = 0
        self.dp = 0
        self.flag = 0
    
    def cal(self, g_w, tin_w, tdb, rh):
        """
        计算冷却塔组性能
        
        Args:
            g_w: 总冷却水流量 [m³/min]
            tin_w: 冷却水入口温度 [℃]
            tdb: 干球温度 [℃]
            rh: 相对湿度 [%]
        
        Returns:
            加权平均出口温度 [℃]
        """
        self.g_w = g_w
        self.tin_w = tin_w
        self.tdb = tdb
        self.rh = rh
        
        # 如果总流量为0，所有冷却塔关闭，风扇也关闭
        if g_w <= 0:
            for tower in self.towers:
                tower.inv = 0.0
                tower.g_w = 0
                tower.tout_w = tin_w
                tower.pw = 0
            self.tout_w = tin_w
            self.pw = 0
            self.g_a = 0
            self.inv = 0.0
            return self.tout_w
        
        # 仅给“风机开启(inv>0)”的冷却塔分配流量；风机关停塔不再参与水侧换热
        active_towers_with_fan = [t for t in self.towers if t.inv > 1e-6]
        num_active_towers = len(active_towers_with_fan)
        g_w_per_active_tower = (g_w / num_active_towers) if num_active_towers > 0 else 0.0
        
        # 计算每台冷却塔
        total_pw = 0
        total_g_a = 0
        tout_w_sum = 0
        tout_w_count = 0
        
        for tower in self.towers:
            # 仅给风机开启塔分流；其它塔流量置零
            g_i = g_w_per_active_tower if tower.inv > 1e-6 else 0.0
            tower.cal(g_w=g_i, tin_w=tin_w, tdb=tdb, rh=rh)
            
            # 汇总结果（只统计有流量的冷却塔）
            if tower.g_w > 0:
                total_pw += tower.pw  # 功率：风扇关闭时 pw=0（因为 pw = pw_d * inv^3）
                total_g_a += tower.g_a
                # 出口温度按流量加权平均
                tout_w_sum += tower.tout_w * tower.g_w
                tout_w_count += tower.g_w
        
        # 计算加权平均出口温度
        if tout_w_count > 0:
            self.tout_w = tout_w_sum / tout_w_count
        else:
            self.tout_w = tin_w
        
        # 汇总功率和风量
        self.pw = total_pw
        self.g_a = total_g_a
        
        # 计算平均变频比（用于兼容性）：仅统计有流量且风扇开启的冷却塔
        active_towers = [t for t in self.towers if t.g_w > 0 and t.inv > 0]
        if active_towers:
            self.inv = sum(t.inv for t in active_towers) / len(active_towers)
        else:
            # 无有效运行塔
            self.inv = 0.0
        
        # 计算总压损（并联系统，取单台压损）
        if self.towers[0].g_w > 0:
            self.dp = self.towers[0].dp
        else:
            self.dp = -self.kr * g_w ** 2
        
        return self.tout_w
    
    def set_fan_inv(self, tower_indices, inv_values):
        """
        设置指定冷却塔的风扇变频比
        
        Args:
            tower_indices: 冷却塔索引列表（0-based）或单个索引
            inv_values: 变频比值（0.0~1.0）或列表
        
        示例:
            # 设置第0台冷却塔风扇为50%
            ct_bank.set_fan_inv(0, 0.5)
            
            # 设置第0,1,2台冷却塔风扇分别为0.5, 0.7, 0.8
            ct_bank.set_fan_inv([0, 1, 2], [0.5, 0.7, 0.8])
            
            # 设置所有冷却塔风扇为相同值
            ct_bank.set_fan_inv(range(12), 0.6)
        """
        # 如果冷却塔关闭（g_w=0），强制关闭所有风扇
        # 注意：当 g_w > 0 但风扇关闭（inv=0）时，冷却塔仍会使用自然风（g_a >= 10 m³/min）
        if self.g_w <= 0:
            for tower in self.towers:
                tower.inv = 0.0
            return
        
        # 处理单个索引
        if isinstance(tower_indices, int):
            tower_indices = [tower_indices]
            inv_values = [inv_values]
        
        # 处理单个值应用到多个索引
        if not isinstance(inv_values, (list, tuple)):
            inv_values = [inv_values] * len(tower_indices)
        
        # 设置每台冷却塔的风扇
        for idx, inv in zip(tower_indices, inv_values):
            if 0 <= idx < self.num_towers:
                # 限制在有效范围内
                self.towers[idx].inv = max(0.0, min(1.0, float(inv)))
    
    def set_all_fans_inv(self, inv):
        """
        设置所有冷却塔的风扇为相同变频比
        
        Args:
            inv: 变频比值（0.0~1.0）
        
        注意：
        - 当 inv=0 时，风扇关闭，但冷却塔仍会使用自然风（g_a >= 10 m³/min）进行冷却
        - 当 g_w=0 时，冷却塔关闭，风扇也必须关闭
        - 自然风逻辑在 CoolingTower.cal() 中处理：如果计算出的 g_a < 10，则设置为 g_a = 10
        """
        if self.g_w <= 0:
            inv = 0.0  # 冷却塔关闭时，风扇必须关闭
        
        for tower in self.towers:
            tower.inv = max(0.0, min(1.0, float(inv)))
    
    def get_fan_inv(self, tower_index=None):
        """
        获取冷却塔的风扇变频比
        
        Args:
            tower_index: 冷却塔索引，None表示获取所有
        
        Returns:
            单个值或列表
        """
        if tower_index is None:
            return [t.inv for t in self.towers]
        elif 0 <= tower_index < self.num_towers:
            return self.towers[tower_index].inv
        else:
            return 0.0
    
    def f2p(self, g_w):
        """
        计算压损（用于水力计算）
        
        Args:
            g_w: 总冷却水流量 [m³/min]
        
        Returns:
            压损 [kPa]
        """
        self.g_w = g_w
        # 并联系统，单台流量
        g_w_per_tower = g_w / self.num_towers if self.num_towers > 0 else 0
        if self.towers:
            self.dp = self.towers[0].f2p(g_w_per_tower)
        else:
            self.dp = -self.kr * g_w ** 2 - 9.8 * self.actual_head
        return self.dp
    
    def f2p_co(self):
        """返回压损系数（用于水力计算）"""
        return [- 9.8*self.actual_head, 0, -self.kr]


# 简易 AHU 模型
class AHU_simple:
    """
    简单空调处理单元(AHU)类

    用于模拟空调系统中的空气处理单元，包括温度计算、压力损失计算等功能。

    压力损失系数 ``kr``：
    - 本类构造函数中的 ``kr=1.0`` 仅为**未接入平台配置时的库默认**；
    - 怀德仿真 ``HuaiDeSystem`` 从 ``HUAI_DE_SIM_CONFIG["hydraulics"]["ahu_kr"]`` 读取并传入
      ``AHU_simple(kr=...)``，该键即为可调参数（超参搜索路径 ``hydraulics.ahu_kr`` 与之对应）。
    """
    def __init__(self, kr=1.0):
        """
        初始化AHU_simple对象

        Args:
            kr (float): 压损系数，参与 ``dp = -kr * g^2``（与 BranchW 中作为 ``kr_eq`` 使用一致）。
                独立脚本未配置时默认为 1.0；怀德平台请改 ``huai_de`` 中 ``hydraulics.ahu_kr``。
        """
        # kr_eq     : 压力损失系数
        # q_load    : 负荷热量[MJ/min]
        # q         : 处理热量[MJ/min]
        self.kr = kr          # 压力损失系数
        self.g = 0            # 空气流量 [kg/min]
        self.dp = 0           # 压力损失 [Pa]
        self.tin = 15         # 入口温度 [°C]
        self.tout = 15        # 出口温度 [°C]
        self.q_load = 0       # 负荷热量 [MJ/min]
        self.q = 0            # 处理热量 [MJ/min]
        self.flag = 0         # 标志位，表示是否达到温度上限

    def cal(self, g, tin, q_load):
        """
        计算AHU的温度和压力损失
        
        Args:
            g (float): 空气流量 [kg/min]
            tin (float): 入口温度 [°C]
            q_load (float): 负荷热量 [MJ/min]
            
        Returns:
            float: 出口温度 [°C]
        """
        self.g = g
        self.tin = tin
        self.q_load = q_load
        self.flag = 0
        
        # 根据热平衡计算出口温度
        if self.g > 0:
            self.tout = self.tin + q_load / 4.184 / self.g
        else:
            self.tout = self.tin

        # 温度上限保护，超过25°C时限制为25°C
        if self.tout > 25:
            self.tout = 25
            self.flag = 1

        # 计算实际处理的热量
        self.q = (self.tout - self.tin) * self.g * 4.184

        # 计算压力损失（负值表示阻力）
        self.dp = -self.kr * self.g ** 2

        return self.tout

    def f2p(self, g):
        """
        根据流量计算压力损失
        
        Args:
            g (float): 空气流量 [kg/min]
            
        Returns:
            float: 压力损失 [Pa]
        """
        self.g = g
        self.dp = -self.kr * self.g ** 2
        return self.dp

    def f2p_co(self):
        """
        返回压力损失计算的系数
        
        Returns:
            list: [0, 0, -self.kr] 压力损失公式的系数
        """
        return [0, 0, -self.kr]


# 温度分层型水蓄能罐（基于 popolo 模型；原名蓄热槽，兼用于蓄冷）
class VerticalWaterThermalStorageTank:
    """
    竖直分层水蓄能罐（TES，Thermal Energy Storage）。

    物理模型：罐内液态水按竖直方向分成多层，模拟温度分层、进水喷流、层间导热及
    罐体对外散热。适用于「上暖下冷」或「上冷下暖」的分层蓄能过程。

    命名说明
    --------
    类名与部分注释沿用日文/早期「蓄热槽」语境，但模型本身与蓄冷/蓄热通用：
    - **蓄热**（采暖等）：相对基准温度 ``t_ref`` 存热，``heat > 0`` [MJ]
    - **蓄冷**（空调等）：相对 ``t_ref`` 存冷，``heat < 0`` [MJ]

    典型蓄冷场景：下部存冷水、上部为较暖回水；充冷/放冷时通过 ``sig_downflow`` 指定
    进水方向（自上而下或自下而上），``cal()`` 返回取水侧出口温度 ``tout``。

    不适用
    ------
    冰片/冰球等**相变蓄冰**（需单独冰蓄冷模型）；本类仅针对**液态水**分层蓄能。

    主要参数
    --------
    depth, base_area : 罐深 [m]、截面积 [m²]（容积 = depth × base_area）
    timedelta : 计算步长 [s]
    tes_temp : 各层温度 [°C]，索引 0 为罐顶、末尾为罐底
    t_ref : 基准温度 [°C]，用于 ``heat`` 相对焓差计算
    sig_downflow : 0=自下向上进水，1=自上而下进水（须与现场管口一致）
    heat : 相对 ``t_ref`` 的蓄能量 [MJ]；蓄热为正，**蓄冷为负**

    参见
    ----
    ``cal(tin, g_w, sig_downflow, t_ref, t_ambient)`` → 出口水温 ``tout``
    """

    def water_density(self, temp):
        # temp ℃
        # density kg/m^3
        return (
                    999.83952 + 16.945176 * temp - 7.987041 * 10e-3 * temp ** 2 - 46.170461 * 10e-6 * temp ** 3 + 105.56302 * 10e-9 * temp ** 4 - 280.54253 * 10e-12 * temp ** 5) / (
                1 + 16.879850 * 10e-3 * temp)

    def water_thermal_conductivity(self, temp):
        # 水的导热率 W/(m*K)
        a = [-1.3734399e-1, 4.2128755, -5.9412196, 1.2794890]
        temp_critical_point = 647.096
        temp_k = temp + 273.15
        tr = (temp_critical_point - temp_k) / temp_critical_point

        lamb = a[len(a) - 1]
        for i in range(len(a) - 2, 0, -1):
            lamb = a[i] + lamb * tr
        return lamb

    def water_specific_heat(self, temp):
        # kJ/(kg*K)
        a = [1.0570130, 2.1952960e1, -4.9895501e1, 3.6963413e1]
        temp_critical_point = 647.096
        temp_k = temp + 273.15
        tr = (temp_critical_point - temp_k) / temp_critical_point

        cpw = a[len(a) - 1]
        for i in range(len(a) - 2, 0, -1):
            cpw = a[i] + cpw * tr
        return cpw

    def water_thermal_diffusivity(self, temp):
        # 水的热扩散率 m^2/s
        lamb = self.water_thermal_conductivity(temp)
        cp = self.water_specific_heat(temp)
        rho = self.water_density(temp)
        return lamb / (1000 * cp * rho)

    def TDMA_solver(self, a, b, c, d):
        nf = len(d)
        ac, bc, cc, dc = map(np.array, (a, b, c, d))
        for it in range(1, nf):
            mc = ac[it - 1] / bc[it - 1]
            bc[it] = bc[it] - mc * cc[it - 1]
            dc[it] = dc[it] - mc * dc[it - 1]
        xc = bc
        xc[-1] = dc[-1] / bc[-1]

        for il in range(nf - 2, -1, -1):
            xc[il] = (dc[il] - cc[il] * xc[il + 1]) / bc[il]

        return xc

    def __init__(self, timedelta, depth=6.0, base_area=10.0):
        # 分层索引：0 = 罐顶（上部），num_layer-1 = 罐底（下部）
        self.pipeinstal_height = depth - 0.2  # 安装高度 m
        self.d_in = 0.1  # 流出入口圆管直径 m
        self.depth = depth  # 水槽深度 m
        self.base_area = base_area  # 截面积 m2
        self.timedelta = timedelta  # sec
        self.tin = 7  # 流入温度
        self.g_w = 15 / 60  # 送水流量 m^3/min
        self.heatloss_coef = 0.001 * 4.8 ** 2 * 6 * 0.04 / 0.4  # 热损失率 kw/k  0.04 W/(m*K) 100mm
        self.t_ambient = 25  # 周围温度
        self.sig_downflow = 0  # 向下:1 向上:0 信号
        # self.num_layer = 250  # 分层数量
        self.num_layer = 100  # 分层数量

        # 计算矩阵
        self.cal_mat = np.array([[0] * self.num_layer] * 3, dtype=float)
        self.vec1 = np.array([0] * self.num_layer, dtype=float)
        self.vec2 = np.array([0] * self.num_layer, dtype=float)

        self.dz = self.depth / self.num_layer  # 分层厚度
        self.pipeinstal_layer = int(self.pipeinstal_height / self.dz)  # 流入口所在层（下部）
        self.t_ref = 15  # 基准温度与冷冻机入口温度相同
        self.tes_temp = np.array([self.t_ref] * self.num_layer, dtype=float)
        self.heat = 0  # 蓄能量 [MJ]：相对 t_ref，蓄热 > 0，蓄冷 < 0
        self.tout = 15.0  # 流出温度 [℃]

    def cal(self, tin, g_w, sig_downflow=0, t_ref=15, t_ambient=25):
        """
        单步更新分层温度并计算出口水温。

        Args:
            tin (float): 进水温度 [°C]
            g_w (float): 进水流量 [m³/min]
            sig_downflow (int): 0=下进上出型喷流，1=上进下出型喷流
            t_ref (float): 基准温度 [°C]（蓄冷时通常取设计冷水温度）
            t_ambient (float): 周围环境温度 [°C]

        Returns:
            float: 取水侧出口温度 tout [°C]
        """
        self.tin = tin
        self.g_w = g_w  # [m3/min]
        self.sig_downflow = sig_downflow
        self.t_ambient = t_ambient
        self.t_ref = t_ref
        self.temp_avg = np.sum(self.tes_temp) / self.num_layer  # 蓄熱槽平均温度
        # 混合区喷流分配计算
        if self.g_w == 0:
            # 无流量时，仅考虑热扩散与对外热损失
            self.cal_mat = np.array([[0] * self.num_layer] * 3, dtype=float)
            self.vec1 = np.array([0] * self.num_layer, dtype=float)
            self.vec2 = np.array([0] * self.num_layer, dtype=float)

        elif (self.sig_downflow and self.tin <= self.tes_temp[0]) or (
                not self.sig_downflow and self.tes_temp[self.num_layer - 1] <= self.tin):
            # 下部から温水が流入と上部から冷水が流入の場合、水の密度が逆転するため、逆転の続く層までが完全混合になるとする
            # 水密度反转的层全部视为完全混合，先求平均温度
            if self.sig_downflow:
                temp_mixavg = self.tes_temp[0]
                temp_mix = self.tes_temp[0] + self.timedelta / (self.base_area * self.dz) * (
                        self.tin - self.tes_temp[0]) * self.g_w / 60
            else:
                temp_mixavg = self.tes_temp[len(self.tes_temp) - 1]
                temp_mix = self.tes_temp[len(self.tes_temp) - 1] + self.timedelta / (self.base_area * self.dz) * (
                        self.tin - self.tes_temp[len(self.tes_temp) - 1])

            for num_mixed in range(1, self.num_layer):
                if self.sig_downflow:
                    if self.tes_temp[num_mixed] < temp_mix:
                        break
                    temp_mix = (temp_mix * num_mixed + self.tes_temp[num_mixed]) / (num_mixed + 1)
                    temp_mixavg += self.tes_temp[num_mixed]
                else:
                    tgtlayer = self.num_layer - (num_mixed + 1)
                    if temp_mixavg < self.tes_temp[tgtlayer]:
                        break
                    temp_mix = 0.5 * (temp_mix + self.tes_temp[tgtlayer])
                    temp_mixavg += self.tes_temp[tgtlayer]

            temp_mixavg /= num_mixed
            bf = self.g_w / 60 / (num_mixed * self.dz)

            # 平均温度と噴流配分
            # 平均温度与喷流分配
            for i in range(0, self.num_layer):
                tgtlayer = i
                # 上向き
                if not self.sig_downflow:
                    tgtlayer = self.num_layer - (i + 1)

                if i < num_mixed:
                    self.vec1[tgtlayer] = bf
                    self.tes_temp[tgtlayer] = temp_mixavg
                    self.vec2[tgtlayer] = self.dz / self.base_area * self.vec1[tgtlayer]
                else:
                    self.vec1[tgtlayer] = 0
                    self.vec2[tgtlayer] = 0

                if i != 0:
                    if self.sig_downflow:
                        self.vec2[tgtlayer] += self.vec2[tgtlayer - 1]
                    else:
                        self.vec2[tgtlayer] += self.vec2[tgtlayer + 1]
        else:
            area_pipe = math.pow(self.d_in / 2, 2) * math.pi  # 流入截面积 m^2
            u_waterin2 = math.pow(self.g_w / 60 / area_pipe, 2)  # 流入速度平方 (m/s)^2
            rho = self.water_density(self.tin)

            # 求喷流到达的层
            tgt = rho * u_waterin2 / (9.8 * self.dz)  # 到达层的密度
            rr = 0
            for lmax in range(0, self.num_layer - 1):
                if self.sig_downflow:
                    rr += (self.water_density(self.tes_temp[lmax]) - rho)  # 积累密度差
                else:
                    rr += (rho - self.water_density(self.tes_temp[self.num_layer - lmax - 1]))
                if rr > tgt:
                    break
            if not self.sig_downflow:
                lmax = self.num_layer - lmax - 1

            # 计算混合区深度
            temp_lmax = self.tes_temp[lmax]
            if temp_lmax == self.tin:
                # 到达层温度与流入温度相同，混合区视为 100%
                lm = self.depth
            else:
                rho0 = self.water_density(temp_lmax)
                self.ar = self.d_in * 9.8 * abs(rho0 - rho) / (rho0 * u_waterin2)  # 阿基米德数

                ndt = 0  # 無次元時間
                if self.sig_downflow:
                    for i in range(0, lmax):
                        ndt += (self.tes_temp[i] - temp_lmax)
                else:
                    for i in range(lmax, self.num_layer):
                        ndt += (self.tes_temp[i] - temp_lmax)
                ndt = (ndt * self.dz) / (self.depth * (self.tin - temp_lmax))
                lm = self.depth * 0.8 * math.pow(self.ar, -0.5) * self.d_in / self.depth + 0.5 * ndt  # 混合域深さ

            z1 = 0
            bf = self.g_w / 60 / (2 * lm ** 3)
            for i in range(0, self.num_layer):
                ln = i
                if not self.sig_downflow:
                    ln = self.num_layer - (i + 1)
                z2 = z1 + self.dz
                # vec1 第 ln 层垂直方向单位长度平均流入水量 {m^2/s}
                if z2 < lm:
                    self.vec1[ln] = bf * (3 * lm ** 2 - self.dz ** 2 * (3 * i * (i + 1) + 1))
                elif lm < z1:
                    self.vec1[ln] = 0
                else:
                    self.vec1[ln] = bf * math.pow(i * self.dz - lm, 2) * (i + 2 * lm / self.dz)

                # vec2 第 ln 层垂直水速 Um，使用累积流入水量计算
                if i == 0:
                    self.vec2[ln] = self.dz / self.base_area * self.vec1[ln]
                elif self.sig_downflow:
                    self.vec2[ln] = self.vec2[ln - 1] + self.dz / self.base_area * self.vec1[ln]
                else:
                    self.vec2[ln] = self.vec2[ln + 1] + self.dz / self.base_area * self.vec1[ln]
                z1 = z2

        # 解行列
        outlet_layer = self.pipeinstal_layer  # 3.8/(4/500)
        if not self.sig_downflow:
            # 上向时，流出口在上，流入口在下
            outlet_layer = self.num_layer - self.pipeinstal_layer - 1

        s = self.timedelta * self.water_thermal_diffusivity(self.temp_avg) / (self.dz ** 2)
        p = self.heatloss_coef * self.timedelta / (
                self.water_density(self.temp_avg) * 4.186 * self.depth * self.base_area)

        for i in range(0, self.num_layer):
            r1 = 0
            r2 = 0
            if self.sig_downflow and i != 0 and i <= outlet_layer:
                r1 = self.vec2[i - 1] * self.timedelta / self.dz
            if not self.sig_downflow and i != self.num_layer - 1 and i >= outlet_layer:
                r2 = self.vec2[i + 1] * self.timedelta / self.dz

            if i == self.num_layer - 1:
                self.cal_mat[0, i] = -(2 * s + r1)
            elif i != 0:
                self.cal_mat[0, i] = -(s + r1)

            if i == 0:
                self.cal_mat[2, i] = -(2 * s + r2)
            elif i != self.num_layer - 1:
                self.cal_mat[2, i] = -(s + r2)

            self.cal_mat[1, i] = 2 * s + r1 + r2 + 1 + p
            self.tes_temp[i] += p * self.t_ambient

            if self.vec1[i] != 0:
                q = self.timedelta * self.vec1[i] / self.base_area
                self.cal_mat[1, i] += q
                self.tes_temp[i] += q * self.tin

        self.tes_temp = self.TDMA_solver(self.cal_mat[0, 1:self.num_layer], self.cal_mat[1, :],
                                         self.cal_mat[2, 0:self.num_layer - 1], self.tes_temp)
        self.tout = self.tes_temp[outlet_layer]

        # 相对 t_ref 的蓄能量 [MJ]：蓄热为正，蓄冷为负
        sum = 0
        for i in range(0, len(self.tes_temp)):
            sum += (self.tes_temp[i] - self.t_ref)
        rho_ref = self.water_density(self.t_ref)
        self.heat = 0.001 * sum * rho_ref * 4.186 * self.dz * self.base_area

        return self.tout


# 水-水热交换器
class HeatExchangerW2W():
    def __init__(self):
        self.flowrate_high = 0  # 高温侧流速[m**3/min]
        self.flowrate_low = 0  # 低温侧流速[m**3/min]
        self.t_water_inlet_high = 0  # 高温侧入口温度
        self.t_water_inlet_low = 0  # 低温侧入口温度
        self.t_water_outlet_high = 0  # 高温侧出口温度
        self.t_water_outlet_low = 0  # 低温侧出口温度

    def cal(self, flowrate_high, flowrate_low, t_water_inlet_high, t_water_inlet_low, t_water_outlet_high,
            t_water_outlet_low):
        # 热交换率 k [kW/m**2k]
        # ah, ac: 高温侧、低温侧导热率[kcal/m2h℃]
        # Cp: 流体比热[kcal/kg℃]
        # gamma: 比重[kg/m3]
        # L: 流量[kg/h]
        # S: 过流截面积[m2]
        # eta: 粘性系数[kgs/m2]
        # mu: 粘度[kg/mh] = 3600 * 9.80 * eta
        # lambda: 流体导热率[kcal/mh℃]
        # De = 2cd / (c + d) (c: 通道长[m], d: 通道宽[m])
        # T: 流体温度
        flowrate_high = flowrate_high / 1000 * 60  # kg/s -> m^3/min
        flowrate_low = flowrate_low / 1000 * 60  # kg/s -> m^3/min
        # print(flowrate_high, flowrate_low)
        # 若任一侧流量极小
        if flowrate_high < 0.01 or flowrate_low < 0.01:
            t_water_outlet_high = t_water_inlet_high
            t_water_outlet_low = t_water_inlet_low
        elif flowrate_high < 0.01 and flowrate_low > 0.01:
            t_water_outlet_high = t_water_inlet_high
            t_water_outlet_low = t_water_inlet_low
        elif flowrate_high > 0.01 and flowrate_low < 0.01:
            t_water_outlet_high = t_water_inlet_high
            t_water_outlet_low = t_water_inlet_low
        else:
            # 双侧均有流量
            flag = 0
            # 若高温侧温度低于低温侧，则交换数据再计算
            if t_water_inlet_high < t_water_inlet_low:
                flag = 1
                t_temp = t_water_inlet_high
                t_water_inlet_high = t_water_inlet_low
                t_water_inlet_low = t_temp
                flowrate_temp = flowrate_high
                flowrate_high = flowrate_low
                flowrate_low = flowrate_temp

            cp = 1  # Cp: 流体比热[kcal/kg℃]
            # 设备特性
            s = 0.01
            c = 40
            d = 1
            de = 2 * c * d / (c + d)
            area = 250  # 992.25

            # 计算 ah（高温侧传热系数），高低温侧温度取出入口均值
            t_avg = (t_water_inlet_high + t_water_outlet_high) / 2
            gamma = 1.735 * 10.0 ** (-5.0) * t_avg ** 3.0 - 6.133 * 10.0 ** (-3.0) * t_avg ** 2.0 + 2.704 * 10.0 ** (
                -2.0) * t_avg + 1000.0
            l = flowrate_high * 60 * gamma
            eta = 4.359 * 10.0 ** (-8.0) * t_avg ** 4.0 - 1.109 * 10.0 ** (-5.0) * t_avg ** 3.0 + 1.107 * 10.0 ** (
                -3.0) * t_avg ** 2.0 - 5.824 * 10.0 ** (-2.0) * t_avg + 1.826
            eta = eta * 10.0 ** (- 4.0)
            mu = 3600.0 * 9.80 * eta
            lamb = -5.672 * 10.0 ** (-6.0) * t_avg ** 2.0 + 1.556 * 10.0 ** (-3.0) * t_avg + 0.4894
            ah = 0.023 * cp ** (1.0 / 3.0) * l ** 0.8 * lamb ** (2.0 / 3.0) * s ** (-0.8) * mu ** (
                    -7.0 / 15.0) * de ** (-0.2)

            # wh 计算：高温侧流量(kg/s) × 比热(kJ/kgK)
            wh = flowrate_high / 60 * gamma * 4.186

            # 计算 ac（低温侧传热系数）
            t_avg = (t_water_inlet_low + t_water_outlet_low) / 2
            gamma = 1.735 * 10.0 ** (-5.0) * t_avg ** 3.0 - 6.133 * 10.0 ** (-3.0) * t_avg ** 2.0 + 2.704 * 10.0 ** (
                -2.0) * t_avg + 1000.0
            l = flowrate_low * 60 * gamma
            eta = 4.359 * 10.0 ** (-8.0) * t_avg ** 4.0 - 1.109 * 10.0 ** (-5.0) * t_avg ** 3.0 + 1.107 * 10.0 ** (
                -3.0) * t_avg ** 2.0 - 5.824 * 10.0 ** (-2.0) * t_avg + 1.826
            eta = eta * 10.0 ** (- 4.0)
            mu = 3600.0 * 9.80 * eta
            lamb = -5.672 * 10.0 ** (-6.0) * t_avg ** 2.0 + 1.556 * 10.0 ** (-3.0) * t_avg + 0.4894
            ac = 0.023 * cp ** (1.0 / 3.0) * l ** 0.8 * lamb ** (2.0 / 3.0) * s ** (-0.8) * mu ** (
                    -7.0 / 15.0) * de ** (-0.2)

            # wc 计算：低温侧流量(kg/s) × 比热(kJ/kgK)
            wc = flowrate_low / 60 * gamma * 4.186

            # 计算 k，并从 kcal/m2h℃ 转 kW/m2℃
            k = ah * ac / (ah + ac)
            k *= 1.162 * 10 ** (-3)

            ka = k * area

            wcwh = wc / wh
            z = ka * (1 - wcwh) / wc

            if wcwh != 1:
                x = math.exp(z)
                y = t_water_inlet_high - t_water_inlet_low
                t_water_outlet_high = t_water_inlet_high - y * (1 - x) / (1 - x / wcwh)
                t_water_outlet_low = t_water_inlet_low + y * (1 - x) / (wcwh - x)

                if z > 200:
                    # 逆流型中流量较小侧先充分换热，另一侧按流量决定温升/降
                    if wc > wh:
                        t_water_outlet_high = t_water_inlet_low
                        t_water_outlet_low = (t_water_inlet_high - t_water_inlet_low) * wh / wc + t_water_inlet_low
                    else:
                        t_water_outlet_low = t_water_inlet_high
                        t_water_outlet_high = (t_water_inlet_low - t_water_inlet_high) * wh / wc + t_water_inlet_high
            else:
                y = t_water_inlet_high - t_water_inlet_low
                t_water_outlet_high = t_water_inlet_high - y * ka / (wc + ka)
                t_water_outlet_low = t_water_inlet_low - y * ka / (wc + ka)

            # 二次侧出口不应低于一次侧出口，一次侧出口不应高于二次侧入口
            if t_water_outlet_high < t_water_inlet_low or t_water_outlet_low > t_water_inlet_high:
                # 逆流型中流量较小侧充分换热，其余按流量比例调整
                if flowrate_low > flowrate_high:
                    t_water_outlet_high = t_water_inlet_low
                    t_water_outlet_low = (
                                                     t_water_outlet_high - t_water_inlet_high) * flowrate_high / flowrate_low + t_water_inlet_low
                else:
                    t_water_outlet_low = t_water_inlet_high
                    t_water_outlet_high = (
                                                      t_water_outlet_low - t_water_inlet_low) * flowrate_low / flowrate_high + t_water_inlet_high
            if flag == 1:
                t_temp = t_water_outlet_high
                t_water_outlet_high = t_water_outlet_low
                t_water_outlet_low = t_temp
                flowrate_temp = flowrate_high
                flowrate_high = flowrate_low
                flowrate_low = flowrate_temp

        return flowrate_high, flowrate_low, t_water_inlet_high, t_water_inlet_low, t_water_outlet_high, t_water_outlet_low


# 水-空气热交换器
class HeatExchangerW2A:
    # HVACSIM+
    # 宇田川光弘：《パソコンによる空気調和計算法》，オーム社，p.8-219，1986 年
    # 富樫英介：《Popolo.2.2.0_热环境计算戯法》，第8-9章，2016 年
    def __init__(self, rated_g_air=2.5, rated_v_air=2.99, rated_tdbin_air=27.2, rated_twbin_air=20.1,
                 rated_g_water=1.9833333, rated_v_water=1.25, rated_tin_water=7, rated_q=40.4, rated_rh_border=95):
        # q_load    : 负荷热量[GJ/min]
        # _d        : 定额
        # q         : 换热能力[kW]
        # g         : 流量[kg/s]
        # v         : 速度[m/s]
        # t         : 温度[℃]
        # in, out   : 入口, 出口
        # db, wb    : 干球, 湿球
        # ntu       : 传热单元数（对热容流量的换热能力）[-]
        # eff       : 传热有效度[-]
        # rh_border : 边界相对湿度[%]
        self.rated_v_water = rated_v_water
        self.rated_v_air = rated_v_air
        self.rated_g_air = rated_g_air
        self.rated_g_water = rated_g_water
        self.rated_tdbin_air = rated_tdbin_air
        self.rated_twbin_air = rated_twbin_air
        self.win_air = tdb_twb2w(self.rated_tdbin_air, self.rated_twbin_air)
        self.rated_tin_water = rated_tin_water
        self.rated_q = rated_q
        self.rated_rh_border = rated_rh_border
        self.tout_air = 20
        self.wout_air = 20
        self.rhout_air = 50
        self.rhin_air = 50
        self.tout_water = 10
        self.q = 0
        self.tdb_in_air = 20
        self.w_in_air = 0.001
        self.rh_border = self.rated_rh_border
        self.tin_water = 10
        self.g_air = 0
        self.g_water = 0
        self.tout_air = 0
        self.tdb_in_air = 0
        self.wout_air = 0
        self.tout_water = 0
        self.ratio_drywet = 0
        self.coolingcoil = 0
        self.heatingcoil = 0


        # 传热系数：干盘管 kW/(m^2*K)，湿盘管 kW/[m^2*(kJ/kg)]
        self.rated_coef_dry = 1 / (
                    4.72 + 4.91 * math.pow(self.rated_v_water, -0.8) + 26.7 * math.pow(self.rated_v_air, -0.64))
        self.rated_coef_wet = 1 / (
                    10.044 + 10.44 * math.pow(self.rated_v_water, -0.8) + 39.6 * math.pow(self.rated_v_air, -0.64))

        # 换热面积
        self.rated_cpma = w2cpair(self.win_air)
        self.rated_cap_air = self.rated_g_air * self.rated_cpma
        self.rated_cap_water = self.rated_g_water * 4.186

        if self.rated_tdbin_air < self.rated_tin_water:
            # 制热工况
            self.rated_cap_min = min(self.rated_cap_air, self.rated_cap_water)
            self.rated_cap_max = max(self.rated_cap_air, self.rated_cap_water)

            self.rated_eff = self.rated_q / self.rated_cap_min / (self.rated_tin_water - self.rated_tdbin_air)
            self.rated_ntu = hex_ntu(self.rated_eff, self.rated_cap_min, self.rated_cap_max, 'counterflow')
            self.area_surface = self.rated_ntu * self.rated_cap_min / self.rated_coef_dry
        else:
            # 制冷工况
            self.rated_tout_water = self.rated_tin_water + self.rated_q / self.rated_cap_water
            self.rated_hin_air = tdb_w2h(self.rated_tdbin_air, self.win_air)
            self.rated_hout_air = self.rated_hin_air - self.rated_q / self.rated_g_air

            # 湿工况
            self.rated_wout_air = h_rh2w(self.rated_hout_air, self.rated_rh_border)

            if self.win_air < self.rated_wout_air:
                # 干工况
                self.rated_tout_air = self.rated_tdbin_air - self.rated_q / self.rated_cap_air
                self.rated_d1 = self.rated_tdbin_air - self.rated_tout_water
                self.rated_d2 = self.rated_tout_air - self.rated_tin_water
                self.rated_lmtd = (self.rated_d1 - self.rated_d2) / math.log(self.rated_d1 / self.rated_d2)
                self.area_surface = self.rated_q / self.rated_lmtd / self.rated_coef_dry
            else:
                # 干+湿工况
                # 边界空气状态
                self.rated_t_border_air = w_rh2tdb(self.win_air, self.rated_rh_border)
                self.rated_h_border_air = tdb_w2h(self.rated_t_border_air, self.win_air)

                # 边界水侧状态
                self.rated_h_border_wet = (self.rated_h_border_air - self.rated_hout_air) * self.rated_g_air
                self.rated_t_border_water = self.rated_tin_water + self.rated_h_border_wet / self.rated_cap_water

                # 与水温相同的空气饱和焓
                self.rated_h_water_inlet = tdb2hsat(self.rated_tin_water)
                self.rated_h_border_water = tdb2hsat(self.rated_t_border_water)

                # 干表面
                self.rated_dt1 = self.rated_tdbin_air - self.rated_tout_water
                self.rated_dt2 = self.rated_t_border_air - self.rated_t_border_water
                self.rated_lmtd = (self.rated_dt1 - self.rated_dt2) / math.log(self.rated_dt1 / self.rated_dt2)
                self.rated_area_dry_sur = (self.rated_q - self.rated_h_border_wet) / self.rated_lmtd / self.rated_coef_dry

                # 湿表面
                self.rated_dh1 = self.rated_h_border_air - self.rated_h_border_water
                self.rated_dh2 = self.rated_hout_air - self.rated_h_water_inlet
                self.rated_lmhd = (self.rated_dh1 - self.rated_dh2) / math.log(self.rated_dh1 / self.rated_dh2)
                self.rated_area_wet_sur = self.rated_h_border_wet / self.rated_lmhd / self.rated_coef_wet

                self.area_surface = self.rated_area_dry_sur + self.rated_area_wet_sur

    def cal(self, tdb_in_air, w_in_air, tin_water, g_air, g_water):
        # 仿真输入
        self.tdb_in_air = tdb_in_air
        self.w_in_air = w_in_air
        self.rhin_air = w_tdb2rh(self.w_in_air, self.tdb_in_air)
        self.tin_water = tin_water
        self.g_air = g_air
        self.g_water = g_water
        # 输出
        self.tout_air = 0
        self.wout_air = 0
        self.tout_water = 0
        self.ratio_drywet = 0
        self.coolingcoil = 0
        self.heatingcoil = 0

        self.t_border_water = self.t_border_air = 0
        self.zd = self.wd = self.v1 = self.v2 = self.zw = self.ww = self.v3 = self.v4 = self.v5 = self.v6 = 0
        if self.g_air <= 0 or self.g_water <= 0 or self.tdb_in_air == self.tin_water:
            self.tout_air = self.tdb_in_air
            self.tout_water = self.tin_water
            self.wout_air = self.w_in_air
            self.rhout_air = w_tdb2rh(self.wout_air, self.tout_air)
            self.ratio_drywet = 1
            self.q = 0
            return self.tout_air, self.wout_air, self.rhout_air, self.tout_water, self.ratio_drywet, self.q, self.g_water

        # 水与湿空气的热容流量 [kW/s]
        self.cpma = w2cpair(self.w_in_air)
        self.cap_air = self.g_air * self.cpma
        self.cap_water = self.g_water * 4.186

        # 传热系数：干/湿盘管，随水/空气速度变化
        self.v_water = (self.g_water / self.rated_g_water) * self.rated_v_water
        self.v_air = (self.g_air / self.rated_g_air) * self.rated_v_air
        self.coef_dry = 1 / (4.72 + 4.91 * math.pow(self.v_water, -0.8) + 26.7 * math.pow(self.v_air, -0.64))
        self.coef_wet = 1 / (10.044 + 10.44 * math.pow(self.v_water, -0.8) + 39.6 * math.pow(self.v_air, -0.64))

        if self.tdb_in_air < self.tin_water:
            self.heatingcoil = 1
            self.ratio_drywet = 1

            cap_min = min(self.cap_air, self.cap_water)
            cap_max = max(self.cap_air, self.cap_water)
            ntu = self.coef_dry * self.area_surface / cap_min
            # 传热有效度
            eff = hex_effectiveness(ntu, cap_min / cap_max, 'counterflow')
            # 出口状态与热量
            self.q = eff * cap_min * (self.tin_water - self.tdb_in_air)
            self.tout_air = self.tdb_in_air + self.q / self.cap_air
            self.tout_water = self.tin_water - self.q / self.cap_water
            self.wout_air = self.w_in_air
            self.rhout_air = w_tdb2rh(self.wout_air, self.tout_air)

        else:
            # 制冷，按饱和温度处理
            self.coolingcoil = 1
            t_border = w_rh2tdb(self.w_in_air, self.rh_border)
            hin_air = tdb_w2h(self.tdb_in_air, self.w_in_air)

            # 基于干球温度的饱和焓参数：p_a（斜率）、p_b（截距）
            [p_a, p_b] = getparameter_hex(self.tin_water)
            xd = 1 / self.cap_air
            yd = -1 / self.cap_water
            xw = 1 / self.g_air
            yw = -p_a / self.cap_water

            def efunc(fdrate):

                self.zd = math.exp(self.coef_dry * self.area_surface * fdrate * (xd + yd))
                self.wd = self.zd * xd + yd
                self.v1 = xd * (self.zd - 1) / self.wd
                self.v2 = self.zd * (xd + yd) / self.wd

                self.zw = math.exp(self.coef_wet * self.area_surface * (1 - fdrate) * (xw + yw))
                self.ww = self.zw * xw + yw
                self.v3 = (xw + yw) / self.ww
                self.v4 = xw * (self.zw - 1) / self.ww
                self.v5 = self.zw * (xw + yw) / self.ww
                self.v6 = yw * (1 - self.zw) / self.ww / p_a

                self.t_border_water = (self.v5 * self.tin_water + self.v6 * (
                        hin_air - self.v1 * self.cpma * self.tdb_in_air - p_b)) \
                                      / (1 - self.v1 * self.v6 * self.cpma)
                self.t_border_air = self.tdb_in_air - self.v1 * (self.tdb_in_air - self.t_border_water)
                if fdrate == 1 and self.t_border_air > t_border:
                    return 1
                return t_border - self.t_border_air

            drate = 1

            if 0 < efunc(drate):
                try:
                    drate = optimize.brentq(efunc, 0, 1, xtol=0.0001, maxiter=100)  # brack=(0, 1) tol=0.0001,
                except ValueError:
                    drate = 0
                    efunc(drate)

            # 出口状态
            self.tout_water = self.tdb_in_air - self.v2 * (self.tdb_in_air - self.t_border_water)
            h_border_air = self.cpma * (self.t_border_air - self.tdb_in_air) + hin_air
            h_water_inlet = p_a * self.tin_water + p_b
            hout_air = self.v3 * h_border_air + self.v4 * h_water_inlet
            self.q = self.cap_air * (self.tdb_in_air - self.t_border_air) + self.g_air * (h_border_air - hout_air)
            self.ratio_drywet = drate

            if drate < 1:
                self.wout_air = h_rh2w(hout_air, self.rh_border)
            else:
                self.wout_air = self.w_in_air

            self.tout_air = w_h2tdb(self.wout_air, hout_air)
            self.rhout_air = w_tdb2rh(self.wout_air, self.tout_air)

        return self.tout_air, self.wout_air, self.rhout_air, self.tout_water, self.ratio_drywet, self.q, self.g_water, self.area_surface


# 风门特性与压损计算
class Damper:
    def __init__(self, coef=[[1.0, 0.020], [0.8, 0.2],
                             [0.6, 1.0], [0.4, 2.0], [0.2, 5.0], [0.0, 999.9]]):
        # damp  : 风门开度[0.0~1.0]
        # dp    : 压力损失[Pa]  # 注意单位
        # g     : 流量[m^3/min]
        # dp = a * g^2
        # coef = [[damp1, a_damp1], ... , [dampn, a_dampn]] 各风门开度对应的压损系数（x1 >...> xn, n>=3）
        self.coef = coef
        self.g = 0
        self.damp = 0
        self.dp = 0

    def f2p(self, g):
        n = len(self.coef)
        self.g = g
        if self.damp >= self.coef[0][0]:
            self.dp = self.coef[0][1] * self.g ** 2  # [kPa]
        elif self.damp <= self.coef[n - 1][0]:
            self.dp = self.coef[n - 1][1] * self.g ** 2  # [kPa]
        else:
            for i in range(1, n):  # 查找用于线性插值的上下界曲线
                coef_a = self.coef[i - 1]  # 上界曲线
                coef_b = self.coef[i]  # 下界曲线
                if coef_b[0] <= self.damp < coef_a[0]:
                    break
            a = coef_a[1] * self.g ** 2
            b = coef_b[1] * self.g ** 2
            self.dp = (a - b) / (coef_a[0] - coef_b[0]) * (self.damp - coef_b[0]) + b

        if g >= 0:
            self.dp = -self.dp
        else:
            self.dp = -self.dp

        return self.dp

    def p2f(self, dp):
        n = len(self.coef)
        self.dp = abs(dp)
        if self.damp >= self.coef[0][0]:
            self.g = pow(self.dp / self.coef[0][1], 0.5)
        elif self.damp <= self.coef[n - 1][0]:
            self.g = pow(self.dp / self.coef[n - 1][1], 0.5)
        else:
            for i in range(1, n):  # 查找用于线性插值的上下界曲线
                coef_a = self.coef[i - 1]  # 上界曲线
                coef_b = self.coef[i]  # 下界曲线
                if coef_b[0] <= self.damp < coef_a[0]:
                    break
            a = pow(self.dp / coef_a[1], 0.5)
            b = pow(self.dp / coef_b[1], 0.5)
            self.g = (a - b) / (coef_a[0] - coef_b[0]) * (self.damp - coef_a[0]) + a

        if dp >= 0:
            self.g = self.g
        else:
            self.g = -self.g

        return self.g


# 风机特性与耗电计算
class Fan:
    # 输入额定值
    def __init__(self, pg=[948.66, -0.5041, -0.097, 0], eg=[0.0773, 0.0142, -1.00e-04], r_ef=0.6, g_d=80, inv=1.0, figure=1):
        # pg    : 压力-流量(pg)曲线系数（常数项、一阶、二阶、三阶）
        # eg    : 效率-流量(eg)曲线系数（常数项、一阶、二阶）
        # r_ef  : 额定时最高效率（rated efficiency）
        # inv   : 转速比(0.0~1.0)
        # dp_f  : 风机扬程[Pa]  # 21/05/21 从 kPa 修正为 Pa
        # g     : 流量[m3/min]
        # pw    : 耗电功率[kW]
        # flag  : 计算有问题为1，无问题为0
        # ef    : 效率(0.0~1.0)
        # g_d   : 额定风量[m3/min]
        # figure: 为1时绘制风机性能曲线，否则不绘制

        (filename, line_number, function_name, text) = traceback.extract_stack()[-2]
        self.name = text[:text.find('=')].strip()  # 获取实例名，必须放在 __init__ 最前面

        self.pg = pg
        self.eg = eg
        self.r_ef = r_ef
        self.inv = inv
        self.dp = 0.0
        self.g = 0.0
        self.ef = 0.0
        self.pw = 0.0
        self.flag = 0
        self.num = 1
        self.g_d = g_d

        if figure == 1:
            self.figure_curve()

    def f2p(self, g):  # flow to pressure for fan
        self.g = g
        # 仅在有流量时计算扬程
        if self.g > 0:
            self.dp = (self.pg[0] + self.pg[1] * (self.g / self.inv) + self.pg[2] * (
                    self.g / self.inv) ** 2 + self.pg[3] * (self.g / self.inv) ** 3) * self.inv ** 2
        else:
            self.dp = 0

        if self.dp < 0:
            self.dp = 0
            self.flag = 1
        else:
            self.flag = 0

        return self.dp

    def f2p_co(self):  # coefficient for f2p
        if self.inv > 0:
            co_0 = self.pg[0] * self.inv ** 2
            co_1 = self.pg[1] * self.inv
            co_2 = self.pg[2]
            co_3 = self.pg[3] / self.inv

        else:
            co_0 = 0
            co_1 = 0
            co_2 = 0
            co_3 = 0

        return [co_0, co_1, co_2, co_3]

    def cal(self):
        # 仅在有流量且转速比>0 时计算耗电
        if self.g > 0 and self.inv > 0:
            # G: INV=1.0 时（额定）的流量
            G = self.g / self.inv
            # K: 效率换算系数
            K = (1.0 - (1.0 - self.r_ef) / (self.inv ** 0.2)) / self.r_ef
            # ef: 效率
            self.ef = K * (self.eg[0] + self.eg[1] * G + self.eg[2] * G ** 2)

            self.dp = (self.pg[0] + self.pg[1] * (self.g / self.inv) + self.pg[2] * (
                    self.g / self.inv) ** 2 + self.pg[3] * (self.g / self.inv) ** 3) * self.inv ** 2

            if self.dp < 0:
                self.dp = 0
                self.flag = 1

            #  求轴功率
            if self.ef > 0:
                self.pw = self.g * (self.dp / 1000) / (60 * 0.8 * self.ef)
                # 下式考虑动压，0.8 为实测得到的电机损失修正系数：
                # self.pw = self.g * (self.dp / 1000) / (60 * 0.8 * self.ef) + 1.293/2*(self.g/60)**2/(0.8 * self.ef)
                self.flag = 0
            else:
                self.pw = 0
                self.flag = 2

        else:
            self.pw = 0.0
            self.flag = 0

    def figure_curve(self):
        x_max, _ = quadratic_formula(self.pg[0], self.pg[1], self.pg[2])
        x = np.linspace(0, self.g_d, 50)
        y_p = (self.pg[0] + self.pg[1] * (x/self.inv) + self.pg[2] * (x/self.inv) ** 2) * self.inv ** 2
        x2_max, _ = quadratic_formula(self.pg[0] * self.inv ** 2, self.pg[1] * self.inv, self.pg[2])
        # x2 = np.linspace(0, min(self.g_d, x2_max), 50)
        x2 = np.linspace(0, self.g_d * self.inv, 50)
        k = (1.0 - (1.0 - self.r_ef) / (self.inv ** 0.2)) / self.r_ef
        y_e = k * (self.eg[0] + self.eg[1] * (x2/self.inv) + self.eg[2] * (x2/self.inv) ** 2)
        fig, ax1 = plt.subplots()
        color1 = 'tab:orange'
        ax1.set_xlabel('Flow [m3/min]')
        ax1.set_ylabel('Pressure [Pa]', color=color1)
        ax1.plot(x, y_p, color=color1)
        ax1.tick_params(axis='y', labelcolor=color1)
        ax1.set_ylim(0, self.pg[0] + 10)

        ax2 = ax1.twinx()
        color2 = 'tab:blue'
        ax2.set_ylabel('Efficiency [-]', color=color2)
        ax2.plot(x2, y_e, color=color2)
        ax2.tick_params(axis='y', labelcolor=color2)
        ax2.set_ylim(0, 1)
        plt.title('{}'.format(self.name))

        return plt.show()


# 蒸汽喷雾式加湿器
class SteamSprayHumidifier:
    # from HVACSIM+ TYPE 22 https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nbsir84-2996.pdf p90
    # from TRNSYS https://sel.me.wisc.edu/trnsys/trnlib/aux_heat_and_cool/616new.for
    def __init__(self, area_humidifier=0.42, dp=45, eff=1.0):
        # 通过向气流中喷入蒸汽，提高空气湿度的定压过程，计算出口空气温度、流量与绝对湿度
        # 出口空气绝对湿度由蒸汽流量或饱和绝对湿度（常压）乘以饱和效率所限制

        # 规格
        # area_humidifier       加湿器面积[m2]
        # dp:                   压力损失[Pa]
        # eff:                  饱和效率[-]

        # 输入
        # tdb_air_in:           入口空气干球温度[℃]
        # w_air_in:             入口空气绝对湿度[kg/kg']
        # flowrate_air_in:      入口空气质量流量[kg/s]
        # t_steam_in:           入口水蒸气温度[℃]
        # flowrate_steam_in:    入口水蒸气流量[kg/s]

        # 输出
        # tdb_air_out:          出口空气干球温度[℃]
        # w_air_out:            出口空气绝对湿度[kg/kg']
        # flowrate_air_out:     出口空气质量流量[kg/s]

        # 内部变量
        # Cpa:                  干空气定压比热 [kJ/kg·K]
        # Cps:                  水蒸气定压比热 [kJ/kg·K]
        # Cpai:                 入口含湿空气定压比热 [kJ/kg·K]
        # psat:                 出口空气饱和时水蒸气分压[kPa]
        # wsat:                 出口空气饱和时绝对湿度[kg/kg']

        self.area_humidifier = area_humidifier
        self.dp = dp
        self.eff = eff

        # その都度変わる値
        self.tdb_air_in = 0
        self.w_air_in = 0
        self.flowrate_air_in = 0
        self.flowrate_steam_in = 0
        self.t_steam_in = 0
        self.tdb_air_out = 0
        self.w_air_out = 0
        self.flowrate_air_out = 0

    def cal(self, tdb_air_in, w_air_in, flowrate_air_in, flowrate_steam_in, t_steam_in):
        self.tdb_air_in = tdb_air_in
        self.w_air_in = w_air_in
        self.flowrate_air_in = flowrate_air_in
        self.flowrate_steam_in = flowrate_steam_in
        self.t_steam_in = t_steam_in

        Cpa = 1.006  # 干空气定压比热 [kJ/kg·K]
        Cps = 1.86  # 水蒸气定压比热 [kJ/kg·K]

        # 入口空气定压比热依赖于入口绝对湿度
        Cpai = (Cpa + self.w_air_in * Cps) / (1 + self.w_air_in)

        # 出口空气温度由入口空气与蒸汽温度的加权平均决定
        self.tdb_air_out = (
                                       self.flowrate_steam_in * Cps * self.t_steam_in + self.flowrate_air_in * Cpai * self.tdb_air_in) \
                           / (self.flowrate_steam_in * Cps + self.flowrate_air_in * Cpai)

        # 假设喷入蒸汽全部用于加湿空气时的出口空气绝对湿度
        w_air_out = self.w_air_in + self.flowrate_steam_in * (1 + self.w_air_in) / self.flowrate_air_in

        # 出口空气饱和时的绝对湿度，可通过饱和空气对应的水蒸气分压计算
        p_sat = psy_psat_tsat(self.tdb_air_out)
        w_sat = psy_w_pv(p_sat)

        # 出口空气绝对湿度不能超过“饱和效率 × 饱和绝对湿度”
        self.w_air_out = min(w_air_out, self.eff * w_sat)

        # 由于加入水分，空气质量流量略有增加
        self.flowrate_air_out = self.flowrate_air_in * (1 + self.w_air_out) / (1 + self.w_air_in)

        return self.tdb_air_out, self.w_air_out, self.flowrate_air_out


# 控制相关模型 ###############################################################

# PID 控制（实现中忽略 D 成分，实际为 PI 控制）
class PID:
    """
    PID控制器类（实际实现为PI控制，忽略微分项）
    
    用于温度、压力等参数的自动控制，具有积分饱和保护和积分重置功能
    """
    # __init__ 中给出的参数为默认值，未指定时使用这些默认值
    def __init__(self, mode=1, a_max=1, a_min=0, kp=0.8, ti=10, sig=0, t_reset=30, kg=1, t_step=1,a=0.0):
        """
        初始化PID控制器
        
        Args:
            mode (int): 运行模式，1=运行，0=停止
            a_max (float): 控制输出最大值
            a_min (float): 控制输出最小值
            kp (float): 比例增益
            ti (float): 积分时间常数
            sig (float): 积分累积值
            t_reset (int): 积分重置时间（步数）
            kg (float): 控制量转换系数，-1或1
            t_step (int): 控制步长，1=每步控制，2=每2步控制一次
            a (float): 当前控制输出值
        """
        # mode          : 运行时为1，停止时为0
        # a_max,a_min   : 控制值上下限
        # kp            : 比例增益
        # ti            : 积分时间
        # sp            : 当前时刻被控量设定值（温度、压力等）
        # mv            : 当前时刻被控量测量值
        # sig           : 积分累积值
        # a             : 当前用于执行控制的输出量（频率比、阀门开度等）
        # ctrl          : 本次控制量（增量）
        # kg            : 将 CTRL 转换为执行量时使用的符号系数（-1 或 1）
        # t_reset       : 在设定值异常或控制异常持续一定时间后，重置积分的时间窗口
        # t_step        : 控制步长，1 表示每个时间步输出控制，2 表示每 2 个时间步输出一次
        # 示例：kp=0.06, ti=20
        self.mode = mode                # 运行模式
        self.a_max = a_max              # 控制输出最大值
        self.a_min = a_min              # 控制输出最小值
        self.kp = kp                    # 比例增益
        self.ti = ti                    # 积分时间常数
        self.flag_reset = np.zeros(t_reset)  # 积分重置标志数组
        self.kg = kg                    # 控制量转换系数
        self.sig = sig                  # 积分累积值
        self.t_step = t_step            # 控制步长
        self.t_step_cnt = -1            # 计算步数计数器
        self.a = a                      # 当前控制输出值

    def control(self, sp, mv):
        """
        执行PID控制计算
        
        Args:
            sp (float): 设定值（目标值）
            mv (float): 测量值（当前值）
            
        Returns:
            float: 控制输出值
        """
        if self.mode == 1:  # 运行模式
            self.t_step_cnt += 1
            if self.t_step_cnt % self.t_step == 0:  # 达到控制步长
                self.t_step_cnt = 0

                # 积分项累积
                self.sig += sp - mv
                # PI控制计算：比例项 + 积分项
                ctrl = self.kp * ((sp - mv) + 1 / self.ti * self.sig)

                # 控制量变化限制：每步最大变化5%
                if ctrl > 0.05:
                    ctrl = 0.05
                elif ctrl < -0.05:
                    ctrl = -0.05

                # 更新控制输出值
                self.a = self.a + ctrl * self.kg

                # 控制输出值边界限制
                if self.a > self.a_max:
                    self.a = self.a_max
                elif self.a < self.a_min:
                    self.a = self.a_min

                # 积分饱和保护：检测积分项是否需要重置
                t_reset = self.flag_reset.size
                # 更新重置标志数组（滑动窗口）
                for ii in range(t_reset - 1, 0, -1):
                    self.flag_reset[ii] = self.flag_reset[ii - 1]
                
                # 记录当前偏差方向
                if sp - mv > 0:  # 正偏差
                    self.flag_reset[0] = 1
                elif sp - mv < 0:  # 负偏差
                    self.flag_reset[0] = -1
                else:  # 无偏差
                    self.flag_reset[0] = 0

                # 如果连续同方向偏差，重置积分项
                if all(i == 1 for i in self.flag_reset) == True or all(i == -1 for i in self.flag_reset) == True:
                    self.sig = 0  # 重置积分累积值
                    self.flag_reset = np.zeros(t_reset)  # 重置标志数组

        elif self.mode == 0:  # 停止模式
            self.a = 0  # 输出置零

        return self.a


# 对于带旁通阀的泵，进行旁通阀的开关判断和PI控制 泵为主，阀为辅
class PumpWithBypassValve:  # 使用组合（Composition）这种Python语法
    """
    带旁通阀的泵控制类
    
    实现泵和旁通阀的协调控制，根据控制输出自动切换泵控制和旁通阀控制模式
    具有延迟切换机制，防止频繁模式切换
    """
    def __init__(self, pump_pid, valve_pid, t_wait=15):
        """
        初始化带旁通阀的泵控制器
        
        Args:
            pump_pid (PID): 泵的PID控制器
            valve_pid (PID): 旁通阀的PID控制器
            t_wait (int): 旁通阀开闭切换的等待时间（分钟）
        """
        # pump_pid      : 泵的PID控制
        # valve_pid     : 旁通阀的PID控制
        # t_wait        : 旁通阀开闭切换的效果等待时间[min]
        # a_min         : 作为旁通阀开闭判定的阈值使用
        # flag_switch   : 用于旁通阀开闭判定的数组
        # switch        : 0=仅泵控制，1=旁通阀开启
        self.pump_pid = pump_pid        # 泵的PID控制器
        self.valve_pid = valve_pid      # 旁通阀的PID控制器
        self.t_wait = t_wait            # 切换等待时间（分钟）
        self.flag_switch = np.zeros(self.t_wait)  # 切换标志数组
        self.switch = 0                 # 当前控制模式：0=仅泵控制，1=旁通阀控制
        self.sp = 0                     # 设定值
        self.mv = 0                     # 测量值

    def control(self, sp, mv):
        """
        执行带旁通阀的泵控制逻辑
        
        Args:
            sp (float): 设定值（目标值）
            mv (float): 测量值（当前值）
            
        Returns:
            list: [泵控制输出值, 旁通阀控制输出值]
        """
        self.sp = sp
        self.mv = mv

        # 更新切换标志数组（滑动窗口）
        for i in range(self.t_wait - 1, 0, -1):
            self.flag_switch[i] = self.flag_switch[i - 1]
        
        # 切换判定逻辑：根据当前模式和控制器输出状态决定切换标志
        # switch判定 pump_pid.aには前時刻の値が残っている
        if self.switch == 0 and self.pump_pid.a == self.pump_pid.a_min:  # 泵控制模式下，泵输出达到最小值
            self.flag_switch[0] = 1  # 标志切换到旁通阀控制
        elif self.switch == 0:  # 泵控制模式下，泵输出未达到最小值
            self.flag_switch[0] = 0  # 保持泵控制
        elif self.switch == 1 and self.valve_pid.a == self.valve_pid.a_min:  # 旁通阀控制模式下，阀输出达到最小值
            self.flag_switch[0] = 0  # 标志切换到泵控制
        elif self.switch == 1:  # 旁通阀控制模式下，阀输出未达到最小值
            self.flag_switch[0] = 1  # 保持旁通阀控制

        # 执行模式切换：只有当所有等待时间内的标志都一致时才执行切换
        if self.switch == 1 and all(i == 0 for i in self.flag_switch):  # 从旁通阀控制切换到泵控制
            self.switch = 0
            self.valve_pid.sig = 0  # 切换时重置积分（提高稳定性）
            self.pump_pid.sig = 0
        elif self.switch == 0 and all(i == 1 for i in self.flag_switch):  # 从泵控制切换到旁通阀控制
            self.switch = 1
            self.valve_pid.sig = 0
            self.pump_pid.sig = 0

        # 根据当前模式执行相应的控制
        if self.switch == 0:  # 泵控制模式
            self.valve_pid.a = 0  # 旁通阀输出置零
            self.pump_pid.mode = 1  # 启用泵控制
            self.pump_pid.control(sp=self.sp, mv=self.mv)  # 执行泵控制

        elif self.switch == 1:  # 旁通阀控制模式
            self.valve_pid.control(sp=self.sp, mv=self.mv)  # 执行旁通阀控制
            self.pump_pid.mode = 1  # 保持泵控制器激活状态
            self.pump_pid.a = self.pump_pid.a_min  # 泵输出设为最小值

        return [self.pump_pid.a, self.valve_pid.a]


# 对冷却塔旁通阀等、具有独立控制目标值的旁通阀进行开闭判定与 PI 控制 阀独立控制
class BypassValve:  # 使用组合（composition）方式封装
    def __init__(self, valve_pid, t_wait=15, mode=0):
        # valve_pid     : 旁通阀的 PID 控制器
        # t_wait        : 旁通阀开闭切换的效果等待时间[min]
        # mv_min, max   : 旁通阀开闭判定阈值
        # mode          : 0=mv 变小则开启旁通阀, 1=mv 变大则开启旁通阀
        # switch        : 0=旁通阀关闭, 1=旁通阀开启
        self.valve_pid = valve_pid
        self.t_wait = t_wait
        self.flag_switch = np.zeros(self.t_wait)
        self.mode = mode
        self.thre = 0
        self.switch = 0

    def control(self, sp, mv, thre):
        self.sp = sp
        self.mv = mv
        self.thre = thre

        # switch 判定。valve_pid.a 中保留了前一时刻的值
        for i in range(self.t_wait - 1, 0, -1):
            self.flag_switch[i] = self.flag_switch[i - 1]
        if self.mode == 0:
            if self.switch == 0 and self.mv <= self.thre:
                self.flag_switch[0] = 1
            elif self.switch == 0:
                self.flag_switch[0] = 0
            elif self.switch == 1 and self.valve_pid.a == self.valve_pid.a_min:
                self.flag_switch[0] = 0
            elif self.switch == 1:
                self.flag_switch[0] = 1
        elif self.mode == 1:
            if self.switch == 0 and self.mv >= self.thre:
                self.flag_switch[0] = 1
            elif self.switch == 0:
                self.flag_switch[0] = 0
            elif self.switch == 1 and self.valve_pid.a == self.valve_pid.a_min:
                self.flag_switch[0] = 0
            elif self.switch == 1:
                self.flag_switch[0] = 1

        if self.switch == 1 and all(i == 0 for i in self.flag_switch):
            self.switch = 0
            self.valve_pid.sig = 0  # 切换时重置积分（提高稳定性）
        elif self.switch == 0 and all(i == 1 for i in self.flag_switch):
            self.switch = 1
            self.valve_pid.sig = 0

        if self.switch == 0:
            self.valve_pid.a = 0

        elif self.switch == 1:
            self.valve_pid.control(sp=self.sp, mv=self.mv)

        return self.valve_pid.a


# 具有增减段阈值与效果等待时间的通用台数控制  基于单一变量（如流量）控制
class UnitNum:
    """
    通用台数控制类
    
    基于单一参数（如流量）的台数控制，适用于泵、风机等设备的台数控制
    具有延迟控制机制，防止频繁启停
    """
    def __init__(self, thre_up=[0.5, 1.0], thre_down=[0.4, 0.9], t_wait=15, num=1):
        """
        初始化台数控制器
        
        Args:
            thre_up (list): 增台阈值列表，如[0.5, 1.0]表示1->2台需要0.5，2->3台需要1.0
            thre_down (list): 减台阈值列表，如[0.4, 0.9]表示2->1台需要0.4，3->2台需要0.9
            t_wait (int): 等待时间，防止频繁切换，单位：分钟
            num (int): 初始运行台数，默认为1
        """
        # thre_up       : 增台阈值列表（1->2, 2->3 时使用的阈值）
        # thre_down     : 减台阈值列表（2->1, 3->2 时使用的阈值）
        # t_wait        : 效果等待时间(如 15 分)
        # num           : 运行台数
        # g             : 流量[m3/min]，此处按流量 g 进行台数控制，也可替换为其他变量
        self.thre_up = thre_up          # 增台阈值列表
        self.thre_down = thre_down      # 减台阈值列表
        self.t_wait = t_wait            # 等待时间（分钟）
        self.num = num                  # 当前运行台数
        self.flag_switch = np.ones(t_wait) * num  # 切换标志数组，初始化为当前台数
        self.g = 0                      # 当前控制参数值（如流量）

    def control(self, g):
        """
        执行台数控制逻辑
        
        Args:
            g (float): 当前控制参数值（如流量 [m3/min]）
            
        Returns:
            int: 控制后的运行台数
        """
        self.g = g
        num_max = len(self.thre_up) + 1  # 最大台数

        # 更新切换标志数组（滑动窗口）
        for i in range(self.t_wait - 1, 0, -1):
            self.flag_switch[i] = self.flag_switch[i - 1]

        # 台数控制逻辑
        if self.num == num_max:  # 当前为最大台数
            if self.g < self.thre_down[self.num - 2]:  # 参数值低于减台阈值
                self.flag_switch[0] = self.num - 1
        elif self.num == 1:  # 当前为1台
            if self.g > self.thre_up[self.num - 1]:  # 参数值高于增台阈值
                self.flag_switch[0] = self.num + 1
        elif self.g > self.thre_up[self.num - 1]:  # 参数值高于增台阈值
            self.flag_switch[0] = self.num + 1
        elif self.g < self.thre_down[self.num - 2]:  # 参数值低于减台阈值
            self.flag_switch[0] = self.num - 1
        else:  # 保持当前台数
            self.flag_switch[0] = self.num

        # 台数边界检查
        if self.flag_switch[0] < 1:  # 确保台数不小于1
            self.flag_switch[0] = 1
        elif self.flag_switch[0] > num_max:  # 确保台数不超过最大值
            self.flag_switch[0] = num_max

        # 延迟控制：只有当所有等待时间内的标志都一致时才执行切换
        if all(i > self.num for i in self.flag_switch):  # 所有标志都指示增台
            self.num += 1
        elif all(i < self.num for i in self.flag_switch):  # 所有标志都指示减台
            self.num -= 1

        return self.num


# 冷冻机台数控制  基于双变量（流量+冷量）协同控制
class UnitNumChiller:
    """
    冷冻机组台数控制类
    
    根据流量和冷量阈值自动控制冷冻机组的启动台数，避免频繁启停
    """
    def __init__(self, thre_up_g=[0.5, 1.0], thre_down_g=[0.4, 0.9], thre_up_q=[0.5, 1.0], thre_down_q=[0.4, 0.9],
                 t_wait=15):
        """
        初始化冷冻机组台数控制器
        
        Args:
            thre_up_g (list): 流量增台阈值列表，如[0.5, 1.0]表示1->2台需要0.5，2->3台需要1.0
            thre_down_g (list): 流量减台阈值列表，如[0.4, 0.9]表示2->1台需要0.4，3->2台需要0.9
            thre_up_q (list): 冷量增台阈值列表，如[0.5, 1.0]表示1->2台需要0.5，2->3台需要1.0
            thre_down_q (list): 冷量减台阈值列表，如[0.4, 0.9]表示2->1台需要0.4，3->2台需要0.9
            t_wait (int): 等待时间，防止频繁切换，单位：分钟
        """
        # thre_up_g     : 流量增台阈值列表（1->2, 2->3 时使用的阈值）
        # thre_down_q   : 冷量减台阈值列表（2->1, 3->2 时使用的阈值）
        # t_wait        : 效果等待时间(如 15 分)
        # num           : 运行台数
        # g             : 流量[m3/min]
        # q             : 冷/热量[kW]
        self.thre_up_g = thre_up_g      # 流量增台阈值
        self.thre_down_g = thre_down_g  # 流量减台阈值
        self.thre_up_q = thre_up_q      # 冷量增台阈值
        self.thre_down_q = thre_down_q  # 冷量减台阈值
        self.t_wait = t_wait            # 等待时间（分钟）
        self.num = 1                    # 当前运行台数
        self.flag_switch = np.zeros(t_wait)  # 切换标志数组，用于延迟控制
        self.g = 0                      # 当前流量 [m3/min]

    def control(self, g, q):
        """
        执行台数控制逻辑
        
        Args:
            g (float): 当前流量 [m3/min]
            q (float): 当前冷量 [kW]
            
        Returns:
            int: 控制后的运行台数
        """
        self.g = g
        self.q = q
        num_max = len(self.thre_up_g) + 1  # 最大台数
        flag_g = 0  # 流量控制标志
        flag_q = 0  # 冷量控制标志

        # 更新切换标志数组（滑动窗口）
        for i in range(self.t_wait - 1, 0, -1):
            self.flag_switch[i] = self.flag_switch[i - 1]

        # 基于冷量的增减台指示
        if self.num == num_max:  # 当前为最大台数
            if self.q < self.thre_down_q[self.num - 2]:  # 冷量低于减台阈值
                flag_q = -1
        elif self.num == 1:  # 当前为1台
            if self.q > self.thre_up_q[self.num - 1]:  # 冷量高于增台阈值
                flag_q = 1
        elif self.q > self.thre_up_q[self.num - 1]:  # 冷量高于增台阈值
            flag_q = 1
        elif self.g < self.thre_down_q[self.num - 2]:  # 流量低于减台阈值
            flag_q = -1

        # 基于流量的增减台指示
        if self.num == num_max:  # 当前为最大台数
            if self.g < self.thre_down_g[self.num - 2]:  # 流量低于减台阈值
                flag_g = -1
        elif self.num == 1:  # 当前为1台
            if self.g > self.thre_up_g[self.num - 1]:  # 流量高于增台阈值
                flag_g = 1
        elif self.g > self.thre_up_g[self.num - 1]:  # 流量高于增台阈值
            flag_g = 1
        elif self.g < self.thre_down_g[self.num - 2]:  # 流量低于减台阈值
            flag_g = -1

        # 综合增减台指示
        if flag_g == 1 or flag_q == 1:  # 任一条件满足增台
            self.flag_switch[0] = self.num + 1
        elif flag_g == -1 and flag_q == -1:  # 两个条件都满足减台
            self.flag_switch[0] = self.num - 1
        else:  # 保持当前台数
            self.flag_switch[0] = self.num

        # 延迟控制：只有当所有等待时间内的标志都一致时才执行切换
        if all(i > self.num for i in self.flag_switch):  # 所有标志都指示增台
            self.num += 1
        elif all(i < self.num for i in self.flag_switch):  # 所有标志都指示减台
            self.num -= 1

        return self.num


# 流量计算相关模型 ###########################################################
# 二次方程式求解公式
def quadratic_formula(co_0, co_1, co_2):
    flag = 0
    if co_1 ** 2 - 4 * co_2 * co_0 > 0:
        g1 = (-co_1 + (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
        g2 = (-co_1 - (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
        if max(g1, g2) < 0:
            g = 0.0
            flag = 1
        else:
            g = max(g1, g2)
    else:
        g = 0.0
        flag = 2
    return [g, flag]


# 多台并联泵与旁通阀单元（可类似 Pump 使用）
# 基本功能：
# 表示多台水泵并联加上旁通阀的复杂系统
# 处理泵组、阀门和管路的组合效应

# 主要特点：
# 并联泵组：可以配置多台相同型号的泵（num参数）
# 旁通阀：可选配置旁通阀，用于调节或保护
# 管路损失：考虑了泵侧和阀侧的管路压损
# 智能流量分配：自动计算泵和阀之间的流量分配
class Pump_para:
    # 使用组合方式；__init__ 中为默认值，未指定则采用
    def __init__(self, pump, num=2, valve=None, kr_pipe_pump=0.0, kr_pipe_valve=0.0):
        # pump          : 泵对象，仅支持一种泵
        # num           : 泵台数，至少 1 台
        # valve         : 阀对象，旁通阀
        # kr_pipe_pump  : 泵管路压损系数[kPa/(m3/min)^2]
        # kr_pipe_valve : 旁通阀管路压损系数[kPa/(m3/min)^2]
        # dp            : 单元进出口压差[kPa]，加压为正，减压为负
        # g             : 单元进出口流量[m3/min]
        # para          : 是否为并联泵标志
        self.pump = pump
        self.num = num
        self.valve = valve
        self.kr_pipe_pump = kr_pipe_pump
        self.kr_pipe_valve = kr_pipe_valve
        self.g = 0.0
        self.dp = 0.0
        self.flag = 0
        self.para = 1
        if num < 1:
            print("define at least one pump")

    def f2p(self, g):  # 根据进出口流量求泵/阀流量与压差
        self.g = g
        self.flag = 0
        if self.valve == None:  # 无旁通阀
            if self.pump.inv == 0:  # 泵停机
                self.pump.g = 0.0
                self.dp = 0
            else:
                self.pump.g = self.g / self.num
                self.dp = - self.kr_pipe_pump * self.pump.g ** 2 + self.pump.f2p(self.pump.g)
        else:  # 同时有旁通阀与泵
            if self.valve.vlv == 0:  # 旁通阀全闭
                self.valve.g = 0.0
                self.pump.g = self.g / self.num
                self.dp = - self.kr_pipe_pump * self.pump.g ** 2 + self.pump.f2p(self.pump.g)
            elif self.pump.inv == 0:  # 泵停机且旁通阀开启
                self.pump.g = 0.0
                self.valve.g = self.g
                self.dp = - self.kr_pipe_valve * self.valve.g ** 2 + self.valve.f2p(self.valve.g)
            else:
                [co_0a, co_1a, co_2a] = self.pump.f2p_co() + np.array([0, 0, -self.kr_pipe_pump])  # 二次関数の係数の算出
                [co_0b, co_1b, co_2b] = self.valve.f2p_co() + np.array([0, 0, -self.kr_pipe_valve])
                # co_0a + co_1a*self.pump.g + co_2a*self.pump.g**2 = - co_2b*self.valve.g**2
                # self.num*self.pump.g - self.valve.g = self.g
                # 上記二式をポンプ流量の式に変形した二次方程式の係数は以下のようになる
                [co_0c, co_1c, co_2c] = [co_0a + co_2b * self.g ** 2, co_1a - co_2b * 2 * self.num * self.g,
                                         co_2a + co_2b * self.num ** 2]
                [self.pump.g, flag] = quadratic_formula(co_0c, co_1c, co_2c)
                self.valve.g = self.num * self.pump.g - self.g
                self.dp = - self.kr_pipe_pump * self.pump.g ** 2 + self.pump.f2p(self.pump.g)
                # print("koko?",self.pump.g,self.num,self.g)
        return self.dp

    def p2f(self, dp):  # 根据压差求流量
        self.dp = dp
        self.flag = 0
        if self.valve == None:  # 无旁通阀
            if self.dp > 0:
                if self.pump.inv == 0:  # 泵停机
                    self.g = 0.0
                    self.pump.f2p(self.g)
                    self.flag = 4
                else:
                    [co_0, co_1, co_2] = self.pump.f2p_co() + np.array([-self.dp, 0, -self.kr_pipe_pump])
                    [self.pump.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                    self.g = self.pump.g * self.num

            else:
                self.g = 0.0
                self.pump.f2p(self.g)
                self.flag = 5

        else:  # 同时有泵与旁通阀
            self.dp = dp
            self.flag = 0
            if self.valve.vlv == 0 and self.pump.inv == 0:
                self.valve.g = 0.0
                self.pump.g = 0.0

            elif self.valve.vlv == 0:
                self.valve.g = 0
                [co_0, co_1, co_2] = self.pump.f2p_co() + np.array([-self.dp, 0, -self.kr_pipe_pump])
                [self.pump.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                self.g = self.pump.g * self.num

            elif self.pump.inv == 0:
                self.pump.g = 0.0
                [co_0, co_1, co_2] = self.valve.f2p_co() + np.array([self.dp, 0, -self.kr_pipe_valve])
                [self.valve.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                if co_2 < 0 and self.dp > 0:
                    self.valve.g = (-self.dp / co_2) ** 0.5
                elif co_2 < 0 and self.dp < 0:
                    self.valve.g = -(self.dp / co_2) ** 0.5  # 逆流する
                else:
                    self.valve.g = 0.0
                    self.flag = 5
                self.g = self.valve.g

            else:
                # ポンプの流量
                [co_0, co_1, co_2] = self.pump.f2p_co() + np.array([-self.dp, 0, -self.kr_pipe_pump])
                if co_1 ** 2 - 4 * co_2 * co_0 > 0:
                    g1 = (-co_1 + (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                    g2 = (-co_1 - (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                    if max(g1, g2) < 0:
                        self.pump.g = 0.0
                        self.flag = 3
                    else:
                        self.pump.g = max(g1, g2)
                else:
                    self.pump.g = 0.0
                    self.flag = 4

                # バイパス弁流量
                [co_0, co_1, co_2] = self.valve.f2p_co() + np.array([self.dp, 0, -self.kr_pipe_valve])

                if co_2 < 0 and self.dp > 0:
                    self.valve.g = (-self.dp / co_2) ** 0.5
                elif co_2 < 0 and self.dp < 0:
                    self.valve.g = -(self.dp / co_2) ** 0.5  # 逆流する
                else:
                    self.valve.g = 0.0
                    self.flag = 5

            self.g = self.pump.g * self.num - self.valve.g

        return self.g

    def y2x_func(self, co_0, co_1, co_2, y):
        if co_1 ** 2 - 4 * co_2 * (co_0 - y) > 0:
            x1 = (-co_1 + (co_1 ** 2 - 4 * co_2 * (co_0 - y)) ** 0.5) / (2 * co_2)
            x2 = (-co_1 - (co_1 ** 2 - 4 * co_2 * (co_0 - y)) ** 0.5) / (2 * co_2)
            x = max(x1, x2)
            if x < 0:
                x = 0.0
        else:
            x = 0
        return x

    def f2p_co(self, y_h):  # coefficient for f2p
        # y_h: 需要提高近似精度的中心值
        # 按旁通阀有无进行分支
        if self.valve == None:
            [co_p0, co_p1, co_p2] = self.pump.f2p_co() + np.array([0, 0, -self.kr_pipe_pump])
            [co_p0, co_p1, co_p2] = [co_p0, co_p1 / self.num, co_p2 / self.num ** 2]
            [co_0, co_1, co_2] = [co_p0, co_p1, co_p2]  # 二次関数の係数の算出
        elif self.valve.vlv == 0:
            [co_p0, co_p1, co_p2] = self.pump.f2p_co() + np.array([0, 0, -self.kr_pipe_pump])
            [co_p0, co_p1, co_p2] = [co_p0, co_p1 / self.num, co_p2 / self.num ** 2]
            [co_0, co_1, co_2] = [co_p0, co_p1, co_p2]  # 二次関数の係数の算出

        else:
            # 通过近似式求系数
            [co_p0, co_p1, co_p2] = self.pump.f2p_co() + np.array([0, 0, -self.kr_pipe_pump])
            [co_p0, co_p1, co_p2] = [co_p0, co_p1 / self.num, co_p2 / self.num ** 2]
            [co_v0, co_v1, co_v2] = self.valve.f2p_co() + np.array([0, 0, -self.kr_pipe_valve])
            # x1_min = self.y2x_func(co_p0, co_p1, co_p2+co_v2, 0)
            # y1_max = (-co_v2)*x1_min**2

            y1 = [y_h - 5 + i for i in range(11)]
            x1 = [self.y2x_func(co_p0, co_p1, co_p2, y1[i]) for i in range(11)]
            if co_v2 < 0:
                x2 = [(y1[i] / (-co_v2)) ** 0.5 for i in range(11)]
            else:
                x2 = [0 for i in range(11)]

            n1 = sum(x > 0 for x in x1)
            x1 = x1[:n1]
            x2 = x2[:n1]
            y1 = np.array(y1[:n1])
            x3 = np.array(x1) - np.array(x2)

            [co_2, co_1, co_0] = np.polyfit(x3, y1, 2)

        return [co_0, co_1, co_2]


# 水系统
class BranchW:  # 水配管的基本支路（泵/并联泵含旁通阀、阀、设备串联）
    # 使用组合方式；__init__ 中为默认值，未指定则采用
    def __init__(self, pump=None, valve=None, kr_eq=0.0, kr_pipe=0.0, actual_head=0.0):
        # pump        : 泵对象，可传入并联泵（含旁通阀）对象
        # valve       : 二通阀对象
        # kr_eq       : 设备压损系数[kPa/(m3/min)^2]
        # kr_pipe     : 管道压损系数[kPa/(m3/min)^2]
        # actual_head : 实际扬程[m]，用于如冷却塔的扬水需求
        # dp          : 支路进出口压差[kPa]，加压为正，减压为负
        # g           : 支路进出口流量[m3/min]
        # flag        : 计算合理性标志
        self.rho = 993.326  # 37℃水的密度[kg/m3]
        self.ga = 9.8  # 重力加速度[m/s2]
        self.pump = pump
        self.valve = valve
        self.kr_eq = kr_eq
        self.kr_pipe = kr_pipe
        self.actual_head = actual_head * self.rho * self.ga / 1000  # 将实际扬程由 m 转换为 kPa
        self.dp = 0.0
        self.g = 0.0
        self.flag = 0

    def f2p(self, g):  # 由流量求压差
        self.g = g
        self.flag = 0
        if self.pump == None and self.valve == None:  # 无泵且无阀
            if self.g > 0:
                self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 - self.actual_head
            else:  # 逆流
                self.dp = self.kr_eq * self.g ** 2 + self.kr_pipe * self.g ** 2
                self.flag = 1

        elif self.pump == None:  # 仅有二通阀
            if self.g > 0:
                self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 + self.valve.f2p(
                    self.g) - self.actual_head
            else:  # 逆流
                self.dp = self.kr_eq * self.g ** 2 + self.kr_pipe * self.g ** 2 - self.valve.f2p(self.g)
                self.flag = 2

        elif self.valve == None:  # 仅有泵
            if self.pump.para == 0:  # 非并联泵
                if self.pump.inv == 0.0:  # 泵停机
                    self.dp = 0.0
                    self.g = 0.0
                    self.pump.f2p(self.g)
                else:
                    if self.g > 0:
                        self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 + self.pump.f2p(
                            self.g) - self.actual_head
                    else:  # 逆流（条件需核实）
                        self.g = 0.0
                        self.dp = self.pump.f2p(self.g)
                        self.flag = 3
            else:  # 并联泵
                if self.pump.pump.inv == 0.0:  # 泵停机
                    self.dp = 0.0
                    self.g = 0.0
                    self.pump.f2p(self.g)
                else:
                    if self.g > 0:
                        self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 + self.pump.f2p(
                            self.g) - self.actual_head
                    else:  # 逆流（条件需核实）
                        self.g = 0.0
                        self.dp = self.pump.f2p(self.g)
                        self.flag = 3



        else:  # 同时有泵与阀
            if self.pump.para == 0:  # 非并联泵
                if self.pump.inv == 0.0:  # 泵停机
                    self.dp = 0.0
                    self.g = 0.0
                    self.pump.f2p(self.g)
                else:
                    if self.g > 0:
                        self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 + self.pump.f2p(
                            self.g) + self.valve.f2p(self.g) - self.actual_head
                    else:  # 逆流（条件需核实）
                        self.g = 0.0
                        self.dp = self.pump.f2p(self.g)
                        self.flag = 4
            else:  # 并联泵
                if self.pump.pump.inv == 0.0:  # 泵停机
                    self.dp = 0.0
                    self.g = 0.0
                    self.pump.f2p(self.g)
                else:
                    if self.g > 0:
                        self.dp = - self.kr_eq * self.g ** 2 - self.kr_pipe * self.g ** 2 + self.pump.f2p(
                            self.g) + self.valve.f2p(self.g) - self.actual_head
                    else:  # 逆流（条件需核实）
                        self.g = 0.0
                        self.dp = self.pump.f2p(self.g)
                        self.flag = 4

        return self.dp

    def p2f(self, dp):  # 由压差求流量
        self.dp = dp
        self.flag = 0
        if self.pump == None and self.valve == None:  # 无泵也无二通阀
            if self.dp < 0:
                [co_0, co_1, co_2] = np.array([self.dp - self.actual_head, 0, self.kr_eq + self.kr_pipe])  # 二次项系数
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
            else:  # 逆流
                [co_0, co_1, co_2] = np.array([-self.dp, 0, self.kr_pipe + self.kr_eq])  # 二次関数の係数の算出
                [g, flag] = quadratic_formula(co_0, co_1, co_2)
                self.g = -g
                self.flag = 1

        elif self.pump == None:  # 仅二通阀
            if self.dp < 0:
                [co_0, co_1, co_2] = self.valve.f2p_co() + np.array(
                    [-self.dp - self.actual_head, 0, -self.kr_eq - self.kr_pipe])
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                self.valve.f2p(self.g)
            else:  # 逆流
                [co_0, co_1, co_2] = self.valve.f2p_co() + np.array([self.dp, 0, -self.kr_eq - self.kr_pipe])
                [g, flag] = quadratic_formula(co_0, co_1, co_2)
                self.g = -g
                self.valve.f2p(self.g)
                self.flag = 3

        elif self.valve == None:  # 仅泵

            # print(self.pump.f2p_co(),co_0, co_1, co_2)

            if self.pump.para == 0:  # 非并联泵
                [co_0, co_1, co_2] = self.pump.f2p_co() + np.array(
                    [-self.dp - self.actual_head, 0, -self.kr_eq - self.kr_pipe])
                if self.pump.inv == 0:  # 泵停机
                    self.g = 0.0
                    self.pump.f2p(self.g)
                    self.flag = 4
                else:
                    # print("CP1", [co_0, co_1, co_2])
                    [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                    self.pump.f2p(self.g)

            else:  # 并联泵
                [co_0, co_1, co_2] = self.pump.f2p_co(y_h=self.dp) + np.array(
                    [-self.dp - self.actual_head, 0, -self.kr_eq - self.kr_pipe])
                if self.pump.pump.inv == 0:  # 泵停机
                    self.g = 0.0
                    self.pump.f2p(self.g)
                    self.flag = 4
                else:
                    # print("CP1s", [co_0, co_1, co_2])
                    [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                    self.pump.f2p(self.g)


        else:  # 同时有泵与二通阀
            if self.pump.para == 0:  # 非并联泵
                [co_0, co_1, co_2] = self.pump.f2p_co() + self.valve.f2p_co() + np.array(
                    [-self.dp - self.actual_head, 0, -self.kr_eq - self.kr_pipe])
                if self.pump.inv == 0:  # 泵停机
                    self.g = 0.0
                    self.pump.f2p(self.g)
                    self.valve.f2p(self.g)
                    self.flag = 4
                else:
                    [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                    self.pump.f2p(self.g)
                    self.valve.f2p(self.g)
            else:  # 并联泵
                [co_0, co_1, co_2] = self.pump.f2p_co(y_h=self.dp) + self.valve.f2p_co() + np.array(
                    [-self.dp - self.actual_head, 0, -self.kr_eq - self.kr_pipe])
                if self.pump.pump.inv == 0:  # 泵停机
                    self.g = 0.0
                    self.pump.f2p(self.g)
                    self.valve.f2p(self.g)
                    self.flag = 4
                else:
                    [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
                    self.pump.f2p(self.g)
                    self.valve.f2p(self.g)

        return self.g


# 带泵、设备、旁通阀的支路
class BranchW1:  # 使用组合方式
    def __init__(self, valve, pump, kr_eq=0.5, kr_pipe=0.5, kr_pipe_bypass=0.5):
        # valve         : 阀门对象
        # pump          : 泵对象
        # kr_pipe       : 泵/设备所在管道的压损系数
        # dp            : 支路进出口压差[kPa]，加压为正，减压为负
        self.valve = valve
        self.pump = pump
        self.kr_eq = kr_eq
        self.kr_pipe = kr_pipe
        self.kr_pipe_bypass = kr_pipe_bypass
        self.g = 0.0
        self.dp = 0.0
        self.flag = 0

    def p2f(self, dp):  # 由压差求流量（dp=0时是否仍会流动？？）
        self.dp = dp
        self.flag = 0
        if self.valve.vlv == 0 and self.pump.inv == 0:
            self.valve.g = 0.0
            self.pump.g = 0.0

        elif self.valve.vlv == 0:
            self.valve.g = 0
            [co_0, co_1, co_2] = self.pump.f2p_co() + np.array([-self.dp, 0, -self.kr_pipe - self.kr_eq])
            if co_1 ** 2 - 4 * co_2 * co_0 > 0:
                g1 = (-co_1 + (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                g2 = (-co_1 - (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                if max(g1, g2) < 0:
                    self.pump.g = 0.0
                    self.flag = 1
                else:
                    self.pump.g = max(g1, g2)
            else:
                self.pump.g = 0
                self.flag = 1

        elif self.pump.inv == 0:
            self.pump.g = 0.0
            [co_0, co_1, co_2] = self.valve.f2p_co() + np.array([self.dp, 0, -self.kr_pipe_bypass])

            if co_2 < 0 and self.dp < 0:
                self.valve.g = (self.dp / co_2) ** 0.5
            elif co_2 < 0 and self.dp > 0:
                self.valve.g = -(self.dp / -co_2) ** 0.5  # 逆流する
            else:
                self.valve.g = 0.0
                self.flag = 2

        else:
            # 泵的流量
            [co_0, co_1, co_2] = self.pump.f2p_co() + np.array([-self.dp, 0, -self.kr_pipe - self.kr_eq])
            if co_1 ** 2 - 4 * co_2 * co_0 > 0:
                g1 = (-co_1 + (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                g2 = (-co_1 - (co_1 ** 2 - 4 * co_2 * co_0) ** 0.5) / (2 * co_2)
                if max(g1, g2) < 0:
                    self.pump.g = 0.0
                    self.flag = 3
                else:
                    self.pump.g = max(g1, g2)
            else:
                self.pump.g = 0.0
                self.flag = 4

            # バイパス弁流量
            [co_0, co_1, co_2] = self.valve.f2p_co() + np.array([self.dp, 0, -self.kr_pipe_bypass])

            if co_2 < 0 and self.dp > 0:
                self.valve.g = (-self.dp / co_2) ** 0.5
            elif co_2 < 0 and self.dp < 0:
                self.valve.g = -(self.dp / co_2) ** 0.5  # 逆流する
            else:
                self.valve.g = 0.0
                self.flag = 5

        self.g = self.pump.g - self.valve.g

        return self.g


# 空气系统
# 风机、风门、设备串联且各不超过1台的支路。默认无风机、风门、设备。
class BranchA:  # 使用组合方式
    # __init__ 中的值为默认值，未指定则采用
    def __init__(self, fan=None, damper=None, kr_eq=0.0, kr_duct=0.0):
        # fan       : 风机对象
        # damper    : 风门对象
        # kr_eq     : 设备压损系数[Pa/(m3/min)^2]
        # kr_duct   : 风道压损系数[Pa/(m3/min)^2]
        # dp        : 支路进出口压差[Pa]，加压为正，减压为负
        # flag      : 计算合理性标志
        self.fan = fan
        self.damper = damper
        self.kr_eq = kr_eq
        self.kr_duct = kr_duct
        self.dp = 0.0
        self.g = 0.0
        self.flag = 0

    def f2p(self, g):  # 由流量求压差
        self.g = g
        # print("test3")
        if self.fan == None and self.damper == None:  # 无风机且无风门
            if self.g > 0:
                self.dp = - self.kr_duct * self.g ** 2 - self.kr_eq * self.g ** 2
            else:  # 逆流
                self.dp = self.kr_duct * self.g ** 2 + self.kr_eq * self.g ** 2

        elif self.fan == None:  # 仅有风门
            if self.g > 0:
                self.dp = - self.kr_duct * self.g ** 2 - self.kr_eq * self.g ** 2 + self.damper.f2p(self.g)
            else:  # 逆流
                self.dp = self.kr_duct * self.g ** 2 + self.kr_eq * self.g ** 2 - self.damper.f2p(self.g)

        elif self.damper == None:  # 仅有风机
            if self.fan.inv == 0.0:  # 风机停机
                self.dp = 0.0
                self.g = 0.0
                self.fan.f2p(self.g)
            else:
                if self.g > 0:
                    print("test2")
                    self.dp = - self.kr_duct * self.g ** 2 - self.kr_eq * self.g ** 2 + self.fan.f2p(self.g)
                else:  # 逆流
                    self.g = 0.0
                    self.dp = self.fan.f2p(self.g)

        else:  # 同时有风机与风门
            if self.fan.inv == 0.0:  # 风机停机
                self.dp = 0.0
                self.g = 0.0
                self.fan.f2p(self.g)
            else:
                if self.g > 0:
                    self.dp = - self.kr_duct * self.g ** 2 - self.kr_eq * self.g ** 2 + self.fan.f2p(
                        self.g) + self.damper.f2p(self.g)
                else:  # 逆流
                    self.g = 0.0
                    self.dp = self.fan.f2p(self.g)

        return self.dp

    def p2f(self, dp):  # 由压差求流量
        self.dp = dp
        self.flag = 0
        if self.fan == None and self.damper == None:  # 无风机且无风门
            if -self.dp > 0:
                [co_0, co_1, co_2] = np.array([-self.dp, 0, -self.kr_duct - self.kr_eq])  # 计算二次函数系数
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
            else:
                [co_0, co_1, co_2] = np.array([-self.dp, 0, self.kr_duct + self.kr_eq])  # 计算二次函数系数
                [g, flag] = quadratic_formula(co_0, co_1, co_2)
                self.g = -g
                self.flag = 3

        elif self.fan == None:  # 仅有风门
            if -self.dp > 0:
                [co_0, co_1, co_2] = self.damper.f2p_co() + np.array([-self.dp, 0, -self.kr_duct - self.kr_eq])
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)
            else:
                [co_0, co_1, co_2] = self.damper.f2p_co() + np.array([-self.dp, 0, self.kr_duct + self.kr_eq])
                [g, flag] = quadratic_formula(co_0, co_1, co_2)
                self.g = -g
                self.flag = 3

        elif self.damper == None:  # 仅有风机
            [co_0, co_1, co_2] = self.fan.f2p_co() + np.array([-self.dp, 0, -self.kr_duct - self.kr_eq])
            if self.fan.inv == 0:  # 风机停机
                self.g = 0.0
                self.fan.f2p(self.g)
                self.flag = 4
            else:
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)

        else:  # 同时有风机与风门
            [co_0, co_1, co_2] = self.fan.f2p_co() + self.damper.f2p_co() + np.array(
                [-self.dp, 0, -self.kr_duct - self.kr_eq])
            if self.fan.inv == 0:  # 风机停机
                self.g = 0.0
                self.fan.f2p(self.g)
                self.damper.f2p(self.g)
                self.flag = 4
            else:
                [self.g, self.flag] = quadratic_formula(co_0, co_1, co_2)

        if self.fan != None:
            self.fan.g = self.g

        return self.g


# 瞬时均匀扩散、完全绝热、简单的房间空气状态计算模型
class RoomSimple:
    def __init__(self, volume=400.0, timeinterval=1):
        self.volume = volume  # 房间体积[m3]
        self.cp_a = 1020  # 比热 [J/kgK]
        self.rho_a = 1.293  # 密度[kg/m3]
        self.t_room = 26.0
        self.rh_room = 50.0
        # self.timeinterval = timeinterval  # 计算时间间隔[min]

    def cal(self, q, gin, tin, rhin, cal_interval):
        # q   : 负荷热量 [kW]
        # gin : 风量[m3/min]
        # tin : 送风温度[℃]
        # rhin : 送风相对湿度[%, 0~1]
        [h_room, w_room] = tdb_rh2h_x(self.t_room, self.rh_room)  # 比焓、绝对湿度
        tdp = tdb_rh2tdp(self.t_room, self.rh_room)  # 露点温度
        [hin, win] = tdb_rh2h_x(tin, rhin)  # 比焓、绝对湿度

        if self.volume < gin/60*cal_interval:
            t_room = tin
            rh_room = rhin
        else:
            w_room = (w_room * (self.volume - gin/60*cal_interval) + win * gin/60*cal_interval) / self.volume
            self.t_room = ((self.t_room + q*cal_interval/1.02/(self.volume*1.293)) * (self.volume - gin/60*cal_interval) + tin * gin/60*cal_interval) / self.volume

            # h_room = tdb_w2h(self.t_room, w_room)
            # h_room += q/(self.volume*1.293)*cal_interval
            #
            # self.t_room = w_h2tdb(w_room, h_room)
            self.rh_room = w_tdb2rh(w_room, self.t_room)
