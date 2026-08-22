<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SettingOption extends Model
{
    use HasFactory;
    protected $fillable = ['project_id','type','value','sort_order','is_active'];
}
