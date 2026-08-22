<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        Schema::create('scheduled_posts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->nullable()->constrained('projects')->onDelete('set null');
            $table->string('project_name')->nullable();
            $table->string('content_type')->nullable();
            $table->string('channel')->nullable();
            $table->string('platform')->nullable();
            $table->enum('status', ['listed','scheduled','uploaded'])->default('listed');
            $table->dateTime('scheduled_at')->nullable();
            $table->string('uploaded_link')->nullable();
            $table->boolean('is_overdue')->default(false);
            $table->foreignId('created_by')->nullable()->constrained('users')->onDelete('set null');
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('scheduled_posts');
    }
};
